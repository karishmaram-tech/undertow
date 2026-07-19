import { Particle } from './Particle';
import { SpatialHashGrid } from './SpatialHashGrid';
import type {
  Gate,
  Zone,
  Wall,
  SimulationSnapshot,
  ParticleType,
} from './types';

const ADJACENT_OFFSETS = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
];

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimulationWorld {
  particles: Particle[] = [];
  gates: Map<string, Gate> = new Map();
  zones: Map<string, Zone> = new Map();
  walls: Wall[] = [];
  spatialGrid: SpatialHashGrid;

  private seed: number = 12345;
  private prng: () => number = mulberry32(this.seed);
  private particleIdCounter: number = 0;

  width: number;
  height: number;
  simulationTime: number = 0; // In seconds
  totalEscaped: number = 0;

  // Optimized flat static grid structures for wall collisions
  private wallCellStarts = new Int32Array(0);
  private wallCellCounts = new Int32Array(0);
  private flatWallIndices = new Int32Array(0);
  private wallGridCols = 0;
  private wallGridRows = 0;
  private wallGridCellSize = 40;
  private wallGridInitialized = false;

  // Pre-allocated neighbor store for Robert's stress check
  private robertNeighborsStore: Particle[] = [];

  // Parameters for force calculations
  private neighborRadius: number = 40; // interaction distance in pixels (~2m)
  private borderGaps: { x1: number; y1: number; x2: number; y2: number }[] = [];

  private gateCandidates: Particle[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.spatialGrid = new SpatialHashGrid(width, height, 40);
  }

  addParticle(p: Particle) {
    this.particles.push(p);
  }

  addGate(
    gate: Omit<
      Gate,
      'lastPassageTime' | 'currentThroughput' | 'overloaded' | 'passageTimes'
    >
  ) {
    this.gates.set(gate.id, {
      ...gate,
      lastPassageTime: 0,
      currentThroughput: 0,
      overloaded: false,
      passageTimes: [],
    });

    // Record the gate coordinates as a gap in the boundary walls
    this.borderGaps.push({
      x1: gate.x1,
      y1: gate.y1,
      x2: gate.x2,
      y2: gate.y2,
    });
  }

  addZone(zone: Omit<Zone, 'area' | 'currentDensity' | 'particleCount'>) {
    const area = this.calculatePolygonArea(zone.points);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    zone.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    this.zones.set(zone.id, {
      ...zone,
      area,
      currentDensity: 0,
      particleCount: 0,
      minX,
      maxX,
      minY,
      maxY,
    });
  }

  addWall(wall: Wall) {
    this.walls.push(wall);
    this.wallGridInitialized = false;
  }

  private initializeWallGrid() {
    const cellSize = this.wallGridCellSize;
    const cols = Math.ceil(this.width / cellSize);
    const rows = Math.ceil(this.height / cellSize);
    this.wallGridCols = cols;
    this.wallGridRows = rows;
    const numCells = cols * rows;

    this.wallCellStarts = new Int32Array(numCells);
    this.wallCellCounts = new Int32Array(numCells);

    const cutoff = 30; // Wall repulsion cutoff

    // Count walls per cell
    this.walls.forEach((wall) => {
      const minCx = Math.max(
        0,
        Math.floor((Math.min(wall.x1, wall.x2) - cutoff) / cellSize)
      );
      const maxCx = Math.min(
        cols - 1,
        Math.floor((Math.max(wall.x1, wall.x2) + cutoff) / cellSize)
      );
      const minCy = Math.max(
        0,
        Math.floor((Math.min(wall.y1, wall.y2) - cutoff) / cellSize)
      );
      const maxCy = Math.min(
        rows - 1,
        Math.floor((Math.max(wall.y1, wall.y2) + cutoff) / cellSize)
      );

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const index = cy * cols + cx;
          this.wallCellCounts[index]++;
        }
      }
    });

    // Calculate starts
    let currentStart = 0;
    for (let i = 0; i < numCells; i++) {
      this.wallCellStarts[i] = currentStart;
      currentStart += this.wallCellCounts[i];
    }

    // Populate flat indices
    this.flatWallIndices = new Int32Array(currentStart);
    const cellOffsets = new Int32Array(numCells);

    this.walls.forEach((wall, wallIdx) => {
      const minCx = Math.max(
        0,
        Math.floor((Math.min(wall.x1, wall.x2) - cutoff) / cellSize)
      );
      const maxCx = Math.min(
        cols - 1,
        Math.floor((Math.max(wall.x1, wall.x2) + cutoff) / cellSize)
      );
      const minCy = Math.max(
        0,
        Math.floor((Math.min(wall.y1, wall.y2) - cutoff) / cellSize)
      );
      const maxCy = Math.min(
        rows - 1,
        Math.floor((Math.max(wall.y1, wall.y2) + cutoff) / cellSize)
      );

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const cellIdx = cy * cols + cx;
          const writePos = this.wallCellStarts[cellIdx] + cellOffsets[cellIdx];
          this.flatWallIndices[writePos] = wallIdx;
          cellOffsets[cellIdx]++;
        }
      }
    });

    this.wallGridInitialized = true;
  }

  /**
   * Automatically builds boundary walls around the screen width/height,
   * leaving gaps where the gates are located so particles can escape.
   */
  buildBoundaryWalls() {
    // We create four border segments. For simplicity, we can split them or
    // just add walls and let particle-gate intersection check happen slightly
    // inside the wall, or remove walls where gates are.
    // Let's create border walls, but split them around gate regions if they are on borders.
    // Alternatively, we can just add regular walls. If a gate is a segment, we skip wall collisions
    // for that specific border segment.
    // Let's just create 4 border walls but keep them slightly outside or handle gates.
    // If we just add standard boundaries:
    // Left:
    this.addWall({ x1: 0, y1: 0, x2: 0, y2: this.height });
    // Right:
    this.addWall({ x1: this.width, y1: 0, x2: this.width, y2: this.height });
    // Top:
    this.addWall({ x1: 0, y1: 0, x2: this.width, y2: 0 });
    // Bottom:
    this.addWall({ x1: 0, y1: this.height, x2: this.width, y2: this.height });
  }

  setSeed(seed: number) {
    this.seed = seed;
    this.prng = mulberry32(seed);
    this.particleIdCounter = 0;
  }

  random(): number {
    return this.prng();
  }

  spawnParticles(
    count: number,
    type: ParticleType | 'mixed',
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ) {
    const types: ParticleType[] = [
      'general',
      'mobility-impaired',
      'sensory-sensitive',
      'elderly',
      'unaccompanied-minor',
      'guardian',
    ];

    const typeProbabilities = [0.65, 0.05, 0.1, 0.1, 0.05, 0.05];

    const getRandomType = (): ParticleType => {
      if (type !== 'mixed') return type;
      const r = this.random();
      let sum = 0;
      for (let i = 0; i < typeProbabilities.length; i++) {
        sum += typeProbabilities[i];
        if (r <= sum) return types[i];
      }
      return 'general';
    };

    let spawned = 0;
    let attempts = 0;
    const maxAttempts = count * 5;

    while (spawned < count && attempts < maxAttempts) {
      attempts++;
      const rx = minX + this.random() * (maxX - minX);
      const ry = minY + this.random() * (maxY - minY);

      // Find closest exit gate midpoint
      let minD = Infinity;
      let goalX = this.width / 2;
      let goalY = this.height - 10;

      this.gates.forEach((gate) => {
        const mx = (gate.x1 + gate.x2) / 2;
        const my = (gate.y1 + gate.y2) / 2;
        const dist = Math.sqrt((rx - mx) ** 2 + (ry - my) ** 2);
        if (dist < minD) {
          minD = dist;
          goalX = mx;
          goalY = my;
        }
      });

      const pType = getRandomType();
      const id = `p-${this.particleIdCounter++}`;
      const p = new Particle(id, rx, ry, pType, goalX, goalY, () =>
        this.random()
      );

      // Simple overlap prevention on spawn
      let overlaps = false;
      for (let i = 0; i < this.particles.length; i++) {
        const other = this.particles[i];
        const dist = Math.sqrt((other.x - rx) ** 2 + (other.y - ry) ** 2);
        if (dist < p.radius + other.radius + 2) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        this.addParticle(p);
        spawned++;
      }
    }
  }

  setGateCapacity(gateId: string, value: number) {
    const gate = this.gates.get(gateId);
    if (gate) {
      gate.capacity = value;
    }
  }

  overloadGate(gateId: string) {
    const gate = this.gates.get(gateId);
    if (gate) {
      gate.overloaded = true;
      // In overloaded state, we throttle capacity to a very low value (e.g. 10% of standard or 2 particles/sec)
      gate.capacity = Math.max(1, Math.floor(gate.capacity * 0.1));
    }
  }

  getZoneDensity(zoneId: string): number {
    const zone = this.zones.get(zoneId);
    return zone ? zone.currentDensity : 0;
  }

  /**
   * Run one fixed-timestep physics update (dt is typically 0.02s)
   */
  step(dt: number) {
    this.simulationTime += dt;

    // 1. Filter out inactive particles (keep special ones) and rebuild spatial grid
    const activeParticles = this.particles.filter(
      (p) => p.isActive || p.isSpecial
    );
    this.particles = activeParticles;

    this.spatialGrid.clear();
    for (let i = 0; i < activeParticles.length; i++) {
      if (activeParticles[i].isActive) {
        this.spatialGrid.insert(activeParticles[i]);
      }
    }

    // 2. Reset forces and apply goal-seeking force
    for (let i = 0; i < activeParticles.length; i++) {
      const p = activeParticles[i];
      if (!p.isActive) continue;
      p.resetForces();
      p.addGoalSeekingForce();
    }

    // 3. Apply wall repulsion (Optimized via Flat Static Spatial Grid)
    if (!this.wallGridInitialized) {
      this.initializeWallGrid();
    }

    const wCellSize = this.wallGridCellSize;
    const wCols = this.wallGridCols;
    const wRows = this.wallGridRows;

    for (let i = 0; i < activeParticles.length; i++) {
      const p = activeParticles[i];
      if (!p.isActive) continue;

      const cx = Math.floor(p.x / wCellSize);
      const cy = Math.floor(p.y / wCellSize);

      if (cx >= 0 && cx < wCols && cy >= 0 && cy < wRows) {
        const cellIdx = cy * wCols + cx;
        const start = this.wallCellStarts[cellIdx];
        const count = this.wallCellCounts[cellIdx];
        for (let j = 0; j < count; j++) {
          const wallIdx = this.flatWallIndices[start + j];
          this.applyWallRepulsion(p, this.walls[wallIdx]);
        }
      }
    }

    // 4. Apply gate blocking/repulsion force if gate is overloaded or throttled
    for (let i = 0; i < activeParticles.length; i++) {
      const p = activeParticles[i];
      if (!p.isActive) continue;
      this.gates.forEach((gate) => {
        const isThrottled =
          gate.overloaded ||
          (gate.capacity > 0 &&
            this.simulationTime - gate.lastPassageTime < 1.0 / gate.capacity);

        if (isThrottled) {
          // Treat gate as a solid wall for the particle
          this.applyGateRepulsion(p, gate);
        }
      });
    }

    // 5. Apply neighbor-to-neighbor repulsion using Cell-Based Collision Sweep (Newton's Third Law)
    const numCells = this.spatialGrid.cells.length;
    const cols = this.spatialGrid.cols;
    const rows = this.spatialGrid.rows;

    for (let cellIndex = 0; cellIndex < numCells; cellIndex++) {
      const cell = this.spatialGrid.cells[cellIndex];
      const len = cell.length;
      if (len === 0) continue;

      const cx = cellIndex % cols;
      const cy = Math.floor(cellIndex / cols);

      // A. Particle collisions within the same cell
      for (let i = 0; i < len; i++) {
        const p1 = cell[i];
        if (p1.collisionCount >= 8) continue;
        for (let j = i + 1; j < len; j++) {
          const p2 = cell[j];
          if (p2.collisionCount >= 8) continue;
          this.resolveParticleRepulsion(p1, p2);
        }
      }

      // B. Particle collisions with 4 adjacent cells (East, South-East, South, South-West)
      for (let k = 0; k < ADJACENT_OFFSETS.length; k++) {
        const ncx = cx + ADJACENT_OFFSETS[k].dx;
        const ncy = cy + ADJACENT_OFFSETS[k].dy;

        if (ncx >= 0 && ncx < cols && ncy >= 0 && ncy < rows) {
          const neighborIndex = ncy * cols + ncx;
          const neighborCell = this.spatialGrid.cells[neighborIndex];
          const nLen = neighborCell.length;

          for (let i = 0; i < len; i++) {
            const p1 = cell[i];
            if (p1.collisionCount >= 8) continue;
            for (let j = 0; j < nLen; j++) {
              const p2 = neighborCell[j];
              if (p2.collisionCount >= 8) continue;
              this.resolveParticleRepulsion(p1, p2);
            }
          }
        }
      }
    }

    // 6. Update velocity
    for (let i = 0; i < activeParticles.length; i++) {
      const p = activeParticles[i];
      if (!p.isActive) continue;
      p.updateVelocity(dt);
    }

    // 7. Check for gate crossings using pre-filtered candidates
    this.gates.forEach((gate) => {
      const mx = (gate.x1 + gate.x2) / 2;
      const my = (gate.y1 + gate.y2) / 2;
      const gateLength = Math.sqrt(
        (gate.x2 - gate.x1) ** 2 + (gate.y2 - gate.y1) ** 2
      );
      const queryRadius = gateLength / 2 + 15;

      this.spatialGrid.getNeighborsStore(
        mx,
        my,
        queryRadius,
        this.gateCandidates
      );

      const crossingCandidates: { p: Particle; dist: number }[] = [];

      for (let i = 0; i < this.gateCandidates.length; i++) {
        const p = this.gateCandidates[i];
        const nextX = p.x + p.vx * dt;
        const nextY = p.y + p.vy * dt;

        const crossed = this.lineSegmentsIntersect(
          p.x,
          p.y,
          nextX,
          nextY,
          gate.x1,
          gate.y1,
          gate.x2,
          gate.y2
        );

        if (crossed) {
          const { distance } = this.pointToSegmentDistance(
            p.x,
            p.y,
            gate.x1,
            gate.y1,
            gate.x2,
            gate.y2
          );
          crossingCandidates.push({ p, dist: distance });
        }
      }

      // Sort by closest distance to gate
      crossingCandidates.sort((a, b) => a.dist - b.dist);

      let allowedPassages = 0;
      const secondsSinceLastPassage =
        this.simulationTime - gate.lastPassageTime;
      const minInterval = 1.0 / gate.capacity;

      // Determine if a passage can happen in this physics step
      const canPass =
        gate.capacity > 0 && secondsSinceLastPassage >= minInterval;

      for (let i = 0; i < crossingCandidates.length; i++) {
        const { p } = crossingCandidates[i];

        if (i === 0 && canPass && allowedPassages === 0) {
          // Let this particle pass!
          p.isActive = false;
          if (p.isSpecial) {
            p.escaped = true;
          }
          this.totalEscaped++;
          gate.lastPassageTime = this.simulationTime;
          gate.passageTimes.push(this.simulationTime);
          allowedPassages++;
        } else {
          // Block particle from crossing the gate
          p.vx = 0;
          p.vy = 0;
          // Apply a gentle push back to avoid clipping past the line next frame
          const { nx, ny } = this.pointToSegmentDistance(
            p.x,
            p.y,
            gate.x1,
            gate.y1,
            gate.x2,
            gate.y2
          );
          p.x += nx * 1.5;
          p.y += ny * 1.5;
        }
      }
    });

    // Move particles
    for (let i = 0; i < activeParticles.length; i++) {
      const p = activeParticles[i];
      if (!p.isActive) continue;
      p.updatePosition(dt);

      // Clamp to world boundaries
      if (p.x < p.radius) {
        p.x = p.radius;
        p.vx *= -0.5;
      } else if (p.x > this.width - p.radius) {
        p.x = this.width - p.radius;
        p.vx *= -0.5;
      }
      if (p.y < p.radius) {
        p.y = p.radius;
        p.vy *= -0.5;
      } else if (p.y > this.height - p.radius) {
        p.y = this.height - p.radius;
        p.vy *= -0.5;
      }
    }

    // 8. Update rolling gate throughput values (rolling window of 2 seconds)
    const rollingWindow = 2.0;
    this.gates.forEach((gate) => {
      // Remove timestamps older than window
      gate.passageTimes = gate.passageTimes.filter(
        (t) => this.simulationTime - t <= rollingWindow
      );
      gate.currentThroughput = gate.passageTimes.length / rollingWindow;
    });

    // 9. Re-calculate zone particle counts and densities every 10 steps (0.2s simulated time)
    // to avoid pointInPolygon checks on every single frame/step!
    if (
      this.simulationTime === dt ||
      Math.round(this.simulationTime / dt) % 10 === 0
    ) {
      this.zones.forEach((zone) => {
        let count = 0;
        const minX = zone.minX ?? -Infinity;
        const maxX = zone.maxX ?? Infinity;
        const minY = zone.minY ?? -Infinity;
        const maxY = zone.maxY ?? Infinity;

        for (let i = 0; i < activeParticles.length; i++) {
          const p = activeParticles[i];
          if (p.isActive) {
            // Bounding box pre-filter shortcut
            if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
              if (this.pointInPolygon(p.x, p.y, zone.points)) {
                count++;
              }
            }
          }
        }
        zone.particleCount = count;
        zone.currentDensity = count / Math.max(1, zone.area);
      });
    }

    // 10. Update vulnerable entities state
    this.updateVulnerableEntitiesState(dt);
  }

  private updateVulnerableEntitiesState(dt: number) {
    // A. Sam (Sensory Distress)
    const sam = this.particles.find((p) => p.id === 'special-sam');
    if (sam) {
      let currentZone: Zone | null = null;
      for (const zone of this.zones.values()) {
        if (this.pointInPolygon(sam.x, sam.y, zone.points)) {
          currentZone = zone;
          break;
        }
      }

      if (currentZone) {
        sam.currentZoneId = currentZone.id;
        const score =
          currentZone.currentDensity * 1.5 + currentZone.particleCount * 0.05;
        const sensoryThreshold = 1.8;
        if (score > sensoryThreshold) {
          sam.distress = Math.min(1.0, (sam.distress || 0) + dt * 0.15);
        } else {
          sam.distress = Math.max(0.0, (sam.distress || 0) - dt * 0.1);
        }
      } else {
        sam.currentZoneId = undefined;
        sam.distress = Math.max(0.0, (sam.distress || 0) - dt * 0.1);
      }
    }

    // B. Maria & Child (Separation Alert)
    const maria = this.particles.find((p) => p.id === 'special-maria');
    const child = this.particles.find((p) => p.id === 'special-child');
    if (maria && child) {
      if (maria.escaped || child.escaped) {
        maria.reunificationTriggered = false;
        child.reunificationTriggered = false;
      } else {
        const dist = Math.sqrt(
          (maria.x - child.x) ** 2 + (maria.y - child.y) ** 2
        );
        const limit = 50; // 2.5m
        if (dist > limit) {
          maria.reunificationTriggered = true;
          child.reunificationTriggered = true;
        } else {
          maria.reunificationTriggered = false;
          child.reunificationTriggered = false;
        }
      }
    }

    // C. Robert (Elderly stress speed throttle)
    const robert = this.particles.find((p) => p.id === 'special-robert');
    if (robert && robert.isActive) {
      this.spatialGrid.getNeighborsStore(
        robert.x,
        robert.y,
        40,
        this.robertNeighborsStore
      );
      const neighborCount = this.robertNeighborsStore.filter(
        (n) => n.id !== robert.id && n.isActive
      ).length;

      if (neighborCount > 4) {
        robert.stress = Math.min(1.0, (robert.stress || 0) + dt * 0.25);
      } else {
        robert.stress = Math.max(0.0, (robert.stress || 0) - dt * 0.15);
      }

      if (robert.stress > 0.8) {
        if (!robert.baseSpeed) {
          robert.baseSpeed = robert.desiredSpeed;
        }
        robert.desiredSpeed = robert.baseSpeed * 0.3;
      } else if (robert.baseSpeed) {
        robert.desiredSpeed = robert.baseSpeed;
      }
    }

    // D. Elena (Elena just tracks zone density)
    const elena = this.particles.find((p) => p.id === 'special-elena');
    if (elena) {
      let currentZone: Zone | null = null;
      for (const zone of this.zones.values()) {
        if (this.pointInPolygon(elena.x, elena.y, zone.points)) {
          currentZone = zone;
          break;
        }
      }
      elena.currentZoneId = currentZone ? currentZone.id : undefined;
    }
  }

  private applyWallRepulsion(p: Particle, wall: Wall) {
    const { distance, nx, ny } = this.pointToSegmentDistance(
      p.x,
      p.y,
      wall.x1,
      wall.y1,
      wall.x2,
      wall.y2
    );
    const cutoff = 30; // interaction radius

    if (distance < cutoff) {
      let forceMag = 30000 / (distance * distance);
      const overlap = p.radius - distance;
      if (overlap > 0) {
        forceMag += overlap * 1200;
      }
      p.applyForce(nx * forceMag, ny * forceMag);
    }
  }

  private applyGateRepulsion(p: Particle, gate: Gate) {
    const { distance, nx, ny } = this.pointToSegmentDistance(
      p.x,
      p.y,
      gate.x1,
      gate.y1,
      gate.x2,
      gate.y2
    );
    const cutoff = p.radius + 3;

    if (distance < cutoff) {
      const overlap = p.radius - distance;
      let forceMag = 10000 / (distance * distance);
      if (overlap > 0) {
        forceMag += overlap * 2000; // very strong blocking force
      }
      p.applyForce(nx * forceMag, ny * forceMag);
    }
  }

  private resolveParticleRepulsion(p1: Particle, p2: Particle) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const distSq = dx * dx + dy * dy;
    const r = this.neighborRadius;

    if (distSq < r * r) {
      p1.collisionCount++;
      p2.collisionCount++;
      const dist = Math.sqrt(distSq) || 0.001;
      const overlap = p1.radius + p2.radius - dist;
      const dirX = dx / dist;
      const dirY = dy / dist;

      // Social force repulsion: inverse-square falloff
      const repulsionConst = 20000;
      let forceMag = repulsionConst / (dist * dist);

      // Physical body force if overlapping to avoid clipping
      if (overlap > 0) {
        forceMag += overlap * 600;
      }

      // Scale force based on sensory sensitivity (wants more personal space)
      if (p1.type === 'sensory-sensitive' || p2.type === 'sensory-sensitive') {
        forceMag *= 1.8;
      }

      const fx = dirX * forceMag;
      const fy = dirY * forceMag;

      p1.applyForce(fx, fy);
      p2.applyForce(-fx, -fy); // Newton's Third Law: Equal and opposite!
    }
  }

  private pointToSegmentDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const cx = x1 + t * dx;
    const cy = y1 + t * dy;

    const vx = px - cx;
    const vy = py - cy;
    const distance = Math.sqrt(vx * vx + vy * vy) || 0.001;

    return {
      distance,
      nx: vx / distance,
      ny: vy / distance,
      cx,
      cy,
    };
  }

  private lineSegmentsIntersect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    x4: number,
    y4: number
  ): boolean {
    const r_px = x1;
    const r_py = y1;
    const r_dx = x2 - x1;
    const r_dy = y2 - y1;

    const s_px = x3;
    const s_py = y3;
    const s_dx = x4 - x3;
    const s_dy = y4 - y3;

    const r_xs_n = r_dx * s_dy - r_dy * s_dx; // cross product

    if (r_xs_n === 0) {
      return false; // parallel
    }

    const t = ((s_px - r_px) * s_dy - (s_py - r_py) * s_dx) / r_xs_n;
    const u = ((s_px - r_px) * r_dy - (s_py - r_py) * r_dx) / r_xs_n;

    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  private calculatePolygonArea(polygon: { x: number; y: number }[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    area = Math.abs(area / 2.0);
    // Convert from pixels^2 to meters^2 (1m = 20px, so 1 sq m = 400 sq px)
    return area / 400.0;
  }

  private pointInPolygon(
    px: number,
    py: number,
    polygon: { x: number; y: number }[]
  ): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;

      const intersect =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  getSnapshot(fps: number = 60): SimulationSnapshot {
    const displayParticles = this.particles.filter(
      (p) => p.isActive || p.isSpecial
    );

    const snapshotParticles = displayParticles.map((p) => p.getState());

    const snapshotGates = Array.from(this.gates.values()).map((g) => ({
      id: g.id,
      name: g.name,
      throughput: g.currentThroughput,
      capacity: g.capacity,
      overloaded: g.overloaded,
    }));

    const snapshotZones = Array.from(this.zones.values()).map((z) => ({
      id: z.id,
      name: z.name,
      density: z.currentDensity,
      particleCount: z.particleCount,
    }));

    return {
      particles: snapshotParticles,
      gates: snapshotGates,
      zones: snapshotZones,
      stats: {
        activeParticles: this.particles.filter((p) => p.isActive).length,
        totalEscaped: this.totalEscaped,
        fps,
        elapsedTime: this.simulationTime,
      },
    };
  }
}
