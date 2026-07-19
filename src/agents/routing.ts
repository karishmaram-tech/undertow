import { SimulationWorld } from '../simulation/SimulationWorld';
import { Particle } from '../simulation/Particle';
import { stadiumLayout } from '../data/stadiumLayout';

export interface RouteWaypoint {
  zoneId: string;
  name: string;
  x: number;
  y: number;
  isDegraded?: boolean;
}

// Zone adjacency graph (edges)
const zoneGraph: Record<string, string[]> = {
  'zone-north-seats': [
    'zone-north-concourse',
    'zone-west-seats',
    'zone-east-seats',
  ],
  'zone-north-concourse': [
    'zone-north-seats',
    'zone-west-concourse',
    'zone-east-concourse',
  ],

  'zone-east-seats': [
    'zone-east-concourse',
    'zone-north-seats',
    'zone-south-seats',
  ],
  'zone-east-concourse': [
    'zone-east-seats',
    'zone-north-concourse',
    'zone-south-concourse',
  ],

  'zone-south-seats': [
    'zone-south-concourse',
    'zone-east-seats',
    'zone-west-seats',
  ],
  'zone-south-concourse': [
    'zone-south-seats',
    'zone-east-concourse',
    'zone-west-concourse',
  ],

  'zone-west-seats': [
    'zone-west-concourse',
    'zone-south-seats',
    'zone-north-seats',
  ],
  'zone-west-concourse': [
    'zone-west-seats',
    'zone-south-concourse',
    'zone-north-concourse',
  ],
};

// Zone physical centers (approximate coordinates)
const zoneCenters: Record<string, { x: number; y: number }> = {
  'zone-north-seats': { x: 600, y: 260 },
  'zone-north-concourse': { x: 600, y: 110 },
  'zone-east-seats': { x: 790, y: 400 },
  'zone-east-concourse': { x: 940, y: 400 },
  'zone-south-seats': { x: 600, y: 540 },
  'zone-south-concourse': { x: 600, y: 690 },
  'zone-west-seats': { x: 410, y: 400 },
  'zone-west-concourse': { x: 260, y: 400 },
};

// Mapping of gates to their closest concourse zone
const gateToZoneMapping: Record<string, string> = {
  'gate-nw': 'zone-north-concourse',
  'gate-ne': 'zone-north-concourse',
  'gate-e': 'zone-east-concourse',
  'gate-se': 'zone-south-concourse',
  'gate-sw': 'zone-south-concourse',
  'gate-w': 'zone-west-concourse',
};

// Helper for point-in-polygon checks
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

// A* Node structure
interface AStarNode {
  zoneId: string;
  gScore: number;
  fScore: number;
  parent: AStarNode | null;
}

export function computeProtectedRoute(
  entity: Particle,
  world: SimulationWorld,
  options?: { elenaDensityThreshold?: number }
): RouteWaypoint[] {
  // 1. Identify start zone
  let startZoneId = entity.currentZoneId;
  if (!startZoneId) {
    for (const zone of world.zones.values()) {
      if (pointInPolygon(entity.x, entity.y, zone.points)) {
        startZoneId = zone.id;
        break;
      }
    }
  }

  // Fallback if not inside any zone, default to nearest seats quadrant
  if (!startZoneId) {
    startZoneId = 'zone-south-seats';
  }

  // 2. Identify target concourse zone from the entity's target gate
  let closestGateId = 'gate-sw';
  let minGateDist = Infinity;
  world.gates.forEach((gate) => {
    const mx = (gate.x1 + gate.x2) / 2;
    const my = (gate.y1 + gate.y2) / 2;
    const dist = Math.sqrt((entity.goalX - mx) ** 2 + (entity.goalY - my) ** 2);
    if (dist < minGateDist) {
      minGateDist = dist;
      closestGateId = gate.id;
    }
  });

  const targetZoneId =
    gateToZoneMapping[closestGateId] || 'zone-south-concourse';

  // If already in target zone, return direct route to it
  if (startZoneId === targetZoneId) {
    const zone = world.zones.get(targetZoneId);
    return [
      {
        zoneId: targetZoneId,
        name: zone ? zone.name : 'Exit Area',
        x: zoneCenters[targetZoneId].x,
        y: zoneCenters[targetZoneId].y,
      },
    ];
  }

  // 3. Run pathfinding
  const elenaThreshold = options?.elenaDensityThreshold ?? 1.2;
  let path: string[] = [];
  let degradationLevel: 'preferred' | 'relaxed' | 'unconstrained' = 'preferred';

  if (entity.id === 'special-elena') {
    // Progressive relaxation of density thresholds to find the safest path for Elena
    const thresholds = [elenaThreshold, 1.6, 2.0];
    for (let i = 0; i < thresholds.length; i++) {
      path = runAStar(entity, world, startZoneId, targetZoneId, {
        useDensityFilter: true,
        elenaDensityThreshold: thresholds[i],
      });
      if (path.length > 0) {
        degradationLevel = i === 0 ? 'preferred' : 'relaxed';
        break;
      }
    }

    // Absolute last resort fallback: disable density constraints completely
    if (path.length === 0) {
      path = runAStar(entity, world, startZoneId, targetZoneId, {
        useDensityFilter: false,
      });
      degradationLevel = 'unconstrained';
    }
  } else if (entity.id === 'special-sam') {
    // Progressive relaxation of sensory load thresholds for Sam
    const thresholds = [3.0, 4.0, 5.0];
    for (let i = 0; i < thresholds.length; i++) {
      path = runAStar(entity, world, startZoneId, targetZoneId, {
        useDensityFilter: true,
        samSensoryThreshold: thresholds[i],
      });
      if (path.length > 0) {
        degradationLevel = i === 0 ? 'preferred' : 'relaxed';
        break;
      }
    }

    // Absolute last resort fallback: disable density/noise filter completely
    if (path.length === 0) {
      path = runAStar(entity, world, startZoneId, targetZoneId, {
        useDensityFilter: false,
      });
      degradationLevel = 'unconstrained';
    }
  } else {
    // Standard pathfinding for everyone else
    path = runAStar(entity, world, startZoneId, targetZoneId, {
      useDensityFilter: false,
    });
  }

  // Map result list of IDs back to waypoint coordinates
  const resultRoute = path.map((zoneId) => {
    const zone = world.zones.get(zoneId);
    const density = zone ? zone.currentDensity : 0;

    // Flag waypoints as degraded/high-risk based on entity profile criteria
    const isDegraded =
      entity.id === 'special-elena'
        ? density > elenaThreshold
        : entity.id === 'special-sam'
          ? (() => {
              const layoutZone = stadiumLayout.zones.find(
                (z) => z.id === zoneId
              );
              const noise = layoutZone ? layoutZone.ambientNoise : 0.5;
              return density * 2.0 + noise * 1.5 > 3.0;
            })()
          : false;

    return {
      zoneId,
      name: zone ? zone.name : zoneId,
      x: zoneCenters[zoneId].x,
      y: zoneCenters[zoneId].y,
      isDegraded,
    };
  });

  // Attach degradation level as a property of the route array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (resultRoute as any).degradationLevel = degradationLevel;
  return resultRoute;
}

function runAStar(
  entity: Particle,
  world: SimulationWorld,
  start: string,
  target: string,
  config: {
    useDensityFilter: boolean;
    elenaDensityThreshold?: number;
    samSensoryThreshold?: number;
  }
): string[] {
  const openSet: AStarNode[] = [];
  const closedSet = new Set<string>();

  // Helper heuristic (Euclidean distance)
  const getHeuristic = (id: string) => {
    const c1 = zoneCenters[id];
    const c2 = zoneCenters[target];
    return Math.sqrt((c1.x - c2.x) ** 2 + (c1.y - c2.y) ** 2);
  };

  const startNode: AStarNode = {
    zoneId: start,
    gScore: 0,
    fScore: getHeuristic(start),
    parent: null,
  };

  openSet.push(startNode);

  while (openSet.length > 0) {
    // Sort open list by fScore to get lowest cost node
    openSet.sort((a, b) => a.fScore - b.fScore);
    const current = openSet.shift()!;

    if (current.zoneId === target) {
      // Reconstruct path
      const path: string[] = [];
      let temp: AStarNode | null = current;
      while (temp) {
        path.unshift(temp.zoneId);
        temp = temp.parent;
      }
      return path;
    }

    closedSet.add(current.zoneId);

    const neighbors = zoneGraph[current.zoneId] || [];

    for (const neighborId of neighbors) {
      if (closedSet.has(neighborId)) continue;

      const neighborZone = world.zones.get(neighborId);
      const density = neighborZone ? neighborZone.currentDensity : 0;

      // Elena: Impassable zone filter
      if (
        config.useDensityFilter &&
        config.elenaDensityThreshold !== undefined
      ) {
        if (density > config.elenaDensityThreshold) {
          continue;
        }
      }

      // Sam: Impassable sensory zone filter
      if (config.useDensityFilter && config.samSensoryThreshold !== undefined) {
        const layoutZone = stadiumLayout.zones.find((z) => z.id === neighborId);
        const noise = layoutZone ? layoutZone.ambientNoise : 0.5;
        const sensoryLoad = density * 2.0 + noise * 1.5;
        if (sensoryLoad > config.samSensoryThreshold) {
          continue;
        }
      }

      // Calculate edge cost based on entity profile criteria
      let stepCost: number;

      if (entity.id === 'special-sam') {
        // Sam (Sensory): Minimize cumulative density and noise load
        const layoutZone = stadiumLayout.zones.find((z) => z.id === neighborId);
        const noise = layoutZone ? layoutZone.ambientNoise : 0.5;
        // Sensory Load cost metric
        const sensoryLoad = density * 2.0 + noise * 1.5;
        // 100x weight on sensory load, distance as secondary tie-breaker
        const p1 = zoneCenters[current.zoneId];
        const p2 = zoneCenters[neighborId];
        const dist = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        stepCost = sensoryLoad * 100 + dist * 0.1;
      } else {
        // Geometric distance cost
        const p1 = zoneCenters[current.zoneId];
        const p2 = zoneCenters[neighborId];
        stepCost = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

        // Elena (Mobility): Penalize turns / direction changes
        if (entity.id === 'special-elena' && current.parent) {
          const prevCenter = zoneCenters[current.parent.zoneId];
          const currCenter = zoneCenters[current.zoneId];
          const nextCenter = zoneCenters[neighborId];

          const v1x = currCenter.x - prevCenter.x;
          const v1y = currCenter.y - prevCenter.y;
          const v2x = nextCenter.x - currCenter.x;
          const v2y = nextCenter.y - currCenter.y;

          const len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 0.001;
          const len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 0.001;

          // Cosine similarity
          const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
          if (dot < 0.95) {
            // Apply a hefty virtual distance penalty for direction changes
            stepCost += 500;
          }
        }
      }

      const tentativeGScore = current.gScore + stepCost;

      // Check if neighbor node already exists in openSet
      const existingNode = openSet.find((node) => node.zoneId === neighborId);

      if (!existingNode) {
        const neighborNode: AStarNode = {
          zoneId: neighborId,
          gScore: tentativeGScore,
          fScore: tentativeGScore + getHeuristic(neighborId),
          parent: current,
        };
        openSet.push(neighborNode);
      } else if (tentativeGScore < existingNode.gScore) {
        existingNode.gScore = tentativeGScore;
        existingNode.fScore = tentativeGScore + getHeuristic(neighborId);
        existingNode.parent = current;
      }
    }
  }

  return []; // Return empty if no path found
}
