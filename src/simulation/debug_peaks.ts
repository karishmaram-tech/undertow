import { SimulationWorld } from './SimulationWorld';
import { Particle } from './Particle';
import { stadiumLayout } from '../data/stadiumLayout';
import type { ParticleType } from './types';

// Ported simple spatial helpers
function pointInPolygon(
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

function findZoneIdForPosition(
  x: number,
  y: number,
  world: SimulationWorld
): string {
  for (const zone of world.zones.values()) {
    if (pointInPolygon(x, y, zone.points)) {
      return zone.id;
    }
  }
  return 'zone-south-seats';
}

function seedVulnerableEntities(world: SimulationWorld) {
  // Elena
  const elena = new Particle(
    'special-elena',
    600,
    180,
    'mobility-impaired',
    600,
    750,
    () => world.random()
  );
  elena.isSpecial = true;
  elena.name = 'Elena';
  elena.desiredSpeed = 14 * 0.4;
  world.addParticle(elena);

  // Sam
  const sam = new Particle(
    'special-sam',
    300,
    380,
    'sensory-sensitive',
    600,
    750,
    () => world.random()
  );
  sam.isSpecial = true;
  sam.name = 'Sam';
  world.addParticle(sam);

  // Maria & Child
  const maria = new Particle(
    'special-maria',
    900,
    380,
    'guardian',
    600,
    750,
    () => world.random()
  );
  maria.isSpecial = true;
  maria.name = 'Maria';

  const child = new Particle(
    'special-child',
    915,
    390,
    'unaccompanied-minor',
    600,
    750,
    () => world.random()
  );
  child.isSpecial = true;
  child.name = 'Child';

  world.addParticle(maria);
  world.addParticle(child);

  // Robert
  const robert = new Particle(
    'special-robert',
    600,
    620,
    'elderly',
    600,
    750,
    () => world.random()
  );
  robert.isSpecial = true;
  robert.name = 'Robert';
  robert.desiredSpeed = 16 * 0.6;
  world.addParticle(robert);

  const specialIds = [
    'special-elena',
    'special-sam',
    'special-maria',
    'special-child',
    'special-robert',
  ];
  specialIds.forEach((id) => {
    const p = world.particles.find((part) => part.id === id);
    if (p) {
      let minD = Infinity;
      let goalX = 600;
      let goalY = 750;
      world.gates.forEach((gate) => {
        const mx = (gate.x1 + gate.x2) / 2;
        const my = (gate.y1 + gate.y2) / 2;
        const dist = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
        if (dist < minD) {
          minD = dist;
          goalX = mx;
          goalY = my;
        }
      });
      p.goalX = goalX;
      p.goalY = goalY;
    }
  });
}

function spawnGeneralCrowd(count: number, world: SimulationWorld) {
  const types = [
    'general',
    'mobility-impaired',
    'sensory-sensitive',
    'elderly',
    'unaccompanied-minor',
    'guardian',
  ];
  const typeProbabilities = [0.65, 0.05, 0.1, 0.1, 0.05, 0.05];

  const getRandomType = (): string => {
    const r = world.random();
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
    const angle = world.random() * Math.PI * 2;
    const rVal = 180 + world.random() * 180;
    const rx = 600 + rVal * Math.cos(angle);
    const ry = 400 + rVal * Math.sin(angle);

    let minD = Infinity;
    let goalX = 600;
    let goalY = 750;

    world.gates.forEach((gate) => {
      const mx = (gate.x1 + gate.x2) / 2;
      const my = (gate.y1 + gate.y2) / 2;
      const dist = Math.sqrt((rx - mx) ** 2 + (ry - my) ** 2);
      if (dist < minD) {
        minD = dist;
        goalX = mx;
        goalY = my;
      }
    });

    const pType = getRandomType() as ParticleType;
    const id = `p-crowd-${world.particles.length}`;
    const p = new Particle(id, rx, ry, pType, goalX, goalY, () =>
      world.random()
    );

    let overlaps = false;
    const queryRadius = p.radius + 12 + 2;
    const neighbors: Particle[] = [];
    world.spatialGrid.getNeighborsStore(rx, ry, queryRadius, neighbors);

    for (let i = 0; i < neighbors.length; i++) {
      const other = neighbors[i];
      const dx = other.x - rx;
      const dy = other.y - ry;
      const distSq = dx * dx + dy * dy;
      const minDist = p.radius + other.radius + 2;
      if (distSq < minDist * minDist) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      world.addParticle(p);
      world.spatialGrid.insert(p);
      spawned++;
    }
  }
}

function runDebugPeaks() {
  const seed = 12345;
  const dt = 0.02;
  const duration = 85;
  const totalSteps = duration / dt;

  const world = new SimulationWorld(1200, 800);
  world.setSeed(seed);
  stadiumLayout.gates.forEach((g) => world.addGate(g));
  stadiumLayout.zones.forEach((z) => world.addZone(z));
  stadiumLayout.walls.forEach((w) => world.addWall(w));

  seedVulnerableEntities(world);
  spawnGeneralCrowd(600, world);

  const peaks: Record<string, number> = {
    'special-elena': 0,
    'special-sam': 0,
    'special-maria': 0,
    'special-child': 0,
    'special-robert': 0,
  };

  for (let step = 0; step < totalSteps; step++) {
    if (world.particles.filter((p) => p.isActive).length < 2000) {
      spawnGeneralCrowd(15, world);
    }
    world.step(dt);

    Object.keys(peaks).forEach((id) => {
      const p = world.particles.find((part) => part.id === id);
      if (p && p.isActive && !p.escaped) {
        const zoneId =
          p.currentZoneId || findZoneIdForPosition(p.x, p.y, world);
        const zone = world.zones.get(zoneId);
        const density = zone ? zone.currentDensity : 0;
        if (density > peaks[id]) {
          peaks[id] = density;
        }
      }
    });
  }

  console.log('Peak Densities Experienced in Run A:');
  Object.keys(peaks).forEach((id) => {
    console.log(`  ${id}: ${peaks[id].toFixed(4)} p/m²`);
  });
}

runDebugPeaks();
