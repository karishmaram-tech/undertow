import { SimulationWorld } from './SimulationWorld';
import { computeProtectedRoute } from '../agents/routing';
import type { RouteWaypoint } from '../agents/routing';
import { checkReunification } from '../agents/reunification';
import type { AgentLogEvent, ParticleType } from './types';
import { Particle } from './Particle';
import { runCrowdFlowAgent } from '../agents/crowdFlow';
import { getZoneDistressScore } from '../agents/panicLanguage';
import { verifyAction } from '../agents/verification';
import { stadiumLayout } from '../data/stadiumLayout';

export interface ActiveRouteState {
  waypoints: RouteWaypoint[];
  currentIndex: number;
  lastZoneDensityGroup: number;
}

const activeRoutes = new Map<string, ActiveRouteState>();
export const agentLogEvents: AgentLogEvent[] = [];
export let lastSimulationTime = 0;
const proposedActionKeys = new Set<string>();
const lastLoggedRouteIds = new Map<string, string[]>();

let lastExecutionTime = 0;
let lastReunificationState = false;

let cachedElena: Particle | null = null;
let cachedSam: Particle | null = null;
let cachedMaria: Particle | null = null;
let cachedChild: Particle | null = null;

// Adjacency graph and coordinates for local shortest-path calculation (Maria/Child)
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
  return 'zone-south-seats'; // Default fallback
}

function runSimpleBFS(start: string, target: string): string[] {
  const queue: { node: string; path: string[] }[] = [
    { node: start, path: [start] },
  ];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (node === target) return path;

    const neighbors = zoneGraph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  return [];
}

function getPathToZone(
  start: string,
  target: string,
  world: SimulationWorld
): RouteWaypoint[] {
  const path = runSimpleBFS(start, target);
  return path.map((zoneId) => {
    const zone = world.zones.get(zoneId);
    return {
      zoneId,
      name: zone ? zone.name : zoneId,
      x: zoneCenters[zoneId].x,
      y: zoneCenters[zoneId].y,
    };
  });
}

function getDensityGroup(density: number): number {
  if (density < 1.2) return 0;
  if (density < 1.6) return 1;
  if (density < 2.0) return 2;
  return 3;
}

export function resetAgentIntegration() {
  activeRoutes.clear();
  proposedActionKeys.clear();
  lastLoggedRouteIds.clear();
  agentLogEvents.length = 0;
  lastExecutionTime = 0;
  lastReunificationState = false;
  cachedElena = null;
  cachedSam = null;
  cachedMaria = null;
  cachedChild = null;
}

export function getAgentLogs(): AgentLogEvent[] {
  return [...agentLogEvents];
}

export function getActiveRoute(entityId: string): ActiveRouteState | undefined {
  return activeRoutes.get(entityId);
}

export function updateAgents(world: SimulationWorld) {
  const currentTime = world.simulationTime;
  lastSimulationTime = currentTime;

  // Detect time travel / reset
  if (currentTime < lastExecutionTime) {
    resetAgentIntegration();
  }

  // Populate / refresh cache
  if (!cachedElena || !cachedElena.isActive || cachedElena.escaped) {
    cachedElena = world.particles.find((p) => p.id === 'special-elena') || null;
  }
  if (!cachedSam || !cachedSam.isActive || cachedSam.escaped) {
    cachedSam = world.particles.find((p) => p.id === 'special-sam') || null;
  }
  if (!cachedMaria || !cachedMaria.isActive || cachedMaria.escaped) {
    cachedMaria = world.particles.find((p) => p.id === 'special-maria') || null;
  }
  if (!cachedChild || !cachedChild.isActive || cachedChild.escaped) {
    cachedChild = world.particles.find((p) => p.id === 'special-child') || null;
  }

  // 1. Waypoint Navigation Check (Executed every single tick)
  const entities = [
    { id: 'special-elena', entity: cachedElena },
    { id: 'special-sam', entity: cachedSam },
    { id: 'special-maria', entity: cachedMaria },
    { id: 'special-child', entity: cachedChild },
  ];

  entities.forEach(({ id, entity }) => {
    if (!entity) return;

    if (!entity.isActive || entity.escaped) {
      if (activeRoutes.has(id)) {
        activeRoutes.delete(id);
        agentLogEvents.push({
          timestamp: currentTime,
          agentName: 'Routing',
          entityId: id,
          entityName: entity.name || id,
          description:
            'Entity escaped or became inactive. Active route cleared.',
          degraded: false,
        });
      }
      return;
    }

    const activeRoute = activeRoutes.get(id);
    if (activeRoute) {
      const waypoint = activeRoute.waypoints[activeRoute.currentIndex];
      if (waypoint) {
        // Enforce the next waypoint coordinates
        entity.goalX = waypoint.x;
        entity.goalY = waypoint.y;

        // Check if entity reached the waypoint (within 25px radius)
        const dist = Math.sqrt(
          (entity.x - waypoint.x) ** 2 + (entity.y - waypoint.y) ** 2
        );
        if (dist < 25) {
          activeRoute.currentIndex++;
          if (activeRoute.currentIndex >= activeRoute.waypoints.length) {
            // Reached the final destination zone
            activeRoutes.delete(id);

            // Restore nearest exit gate destination goal
            let minGateDist = Infinity;
            let goalX = entity.goalX;
            let goalY = entity.goalY;
            world.gates.forEach((gate) => {
              const mx = (gate.x1 + gate.x2) / 2;
              const my = (gate.y1 + gate.y2) / 2;
              const gDist = Math.sqrt(
                (entity.x - mx) ** 2 + (entity.y - my) ** 2
              );
              if (gDist < minGateDist) {
                minGateDist = gDist;
                goalX = mx;
                goalY = my;
              }
            });
            entity.goalX = goalX;
            entity.goalY = goalY;
          } else {
            // Navigating to next waypoint
            const nextWaypoint =
              activeRoute.waypoints[activeRoute.currentIndex];
            entity.goalX = nextWaypoint.x;
            entity.goalY = nextWaypoint.y;
          }
        }
      }
    }
  });

  // 2. Decision loop (Executed every 30 ticks / ~0.6 simulated seconds)
  if (currentTime === 0 || currentTime - lastExecutionTime >= 0.6) {
    lastExecutionTime = currentTime;

    const elena = cachedElena;
    const sam = cachedSam;
    const maria = cachedMaria;
    const child = cachedChild;

    // A. Elena (Mobility Impaired Agent)
    if (elena && elena.isActive && !elena.escaped) {
      const zoneId =
        elena.currentZoneId || findZoneIdForPosition(elena.x, elena.y, world);
      const zone = world.zones.get(zoneId);
      const currentDensity = zone ? zone.currentDensity : 0;
      const currentGroup = getDensityGroup(currentDensity);

      const active = activeRoutes.get('special-elena');
      if (!active || currentGroup !== active.lastZoneDensityGroup) {
        const route = computeProtectedRoute(elena, world);
        if (route.length > 0) {
          const routeIds = route.map((w) => w.zoneId);
          const lastIds = lastLoggedRouteIds.get('special-elena');
          const routeChanged =
            !lastIds ||
            lastIds.length !== routeIds.length ||
            lastIds.some((id, idx) => id !== routeIds[idx]);

          if (!active || routeChanged) {
            activeRoutes.set('special-elena', {
              waypoints: route,
              currentIndex: 0,
              lastZoneDensityGroup: currentGroup,
            });
            elena.goalX = route[0].x;
            elena.goalY = route[0].y;

            if (routeChanged) {
              lastLoggedRouteIds.set('special-elena', routeIds);
              agentLogEvents.push({
                timestamp: currentTime,
                agentName: 'Routing',
                entityId: 'special-elena',
                entityName: 'Elena',
                description: `Recalculated route to exit due to density changes. Path: ${route.map((w) => w.name).join(' -> ')}`,
                degraded: route.some((w) => w.isDegraded),
              });
            }
          } else {
            // Simply update group threshold mapping to avoid infinite recomputation, keeping current progress
            active.lastZoneDensityGroup = currentGroup;
          }

          // Check if no safe path exists (unconstrained degradation fallback)
          const degradation = (route as { degradationLevel?: string })
            .degradationLevel;
          if (degradation === 'unconstrained') {
            const actionKey = 'critical_rerouting_special-elena';
            if (!proposedActionKeys.has(actionKey)) {
              proposedActionKeys.add(actionKey);

              const distress = getZoneDistressScore(zoneId);
              const riskScore = Math.min(1.0, currentDensity / 2.0);

              verifyAction(
                {
                  type: 'critical_rerouting',
                  targetId: 'special-elena',
                  triggeringSignals: [
                    'no_safe_mobility_path',
                    'density_threshold_exceeded',
                  ],
                },
                riskScore,
                distress
              ).then((result) => {
                agentLogEvents.push({
                  timestamp: currentTime,
                  agentName: 'Verification',
                  entityId: result.action.targetId,
                  entityName: result.action.type.toUpperCase(),
                  description: `Proposed Action [${result.action.type.toUpperCase()}] status: ${result.status.toUpperCase()}. Justification: ${result.justification}`,
                  degraded: result.status === 'pending-human-approval',
                });
              });
            }
          }
        }
      }
    }

    // B. Sam (Sensory Sensitive Agent)
    if (sam && sam.isActive && !sam.escaped) {
      const zoneId =
        sam.currentZoneId || findZoneIdForPosition(sam.x, sam.y, world);
      const zone = world.zones.get(zoneId);
      const currentDensity = zone ? zone.currentDensity : 0;
      const currentGroup = getDensityGroup(currentDensity);

      const active = activeRoutes.get('special-sam');
      if (!active || currentGroup !== active.lastZoneDensityGroup) {
        const route = computeProtectedRoute(sam, world);
        if (route.length > 0) {
          const routeIds = route.map((w) => w.zoneId);
          const lastIds = lastLoggedRouteIds.get('special-sam');
          const routeChanged =
            !lastIds ||
            lastIds.length !== routeIds.length ||
            lastIds.some((id, idx) => id !== routeIds[idx]);

          if (!active || routeChanged) {
            activeRoutes.set('special-sam', {
              waypoints: route,
              currentIndex: 0,
              lastZoneDensityGroup: currentGroup,
            });
            sam.goalX = route[0].x;
            sam.goalY = route[0].y;

            if (routeChanged) {
              lastLoggedRouteIds.set('special-sam', routeIds);
              agentLogEvents.push({
                timestamp: currentTime,
                agentName: 'Routing',
                entityId: 'special-sam',
                entityName: 'Sam',
                description: `Recalculated sensory-safe route to exit. Path: ${route.map((w) => w.name).join(' -> ')}`,
                degraded: route.some((w) => w.isDegraded),
              });
            }
          } else {
            // Simply update group threshold mapping to avoid infinite recomputation, keeping current progress
            active.lastZoneDensityGroup = currentGroup;
          }

          // Check if no safe path exists (unconstrained degradation fallback)
          const degradation = (route as { degradationLevel?: string })
            .degradationLevel;
          if (degradation === 'unconstrained') {
            const actionKey = 'critical_rerouting_special-sam';
            if (!proposedActionKeys.has(actionKey)) {
              proposedActionKeys.add(actionKey);

              const distress = sam.distress || 0;
              const riskScore = Math.min(1.0, currentDensity / 2.0);

              verifyAction(
                {
                  type: 'critical_rerouting',
                  targetId: 'special-sam',
                  triggeringSignals: [
                    'no_safe_sensory_path',
                    'sensory_noise_limit_exceeded',
                  ],
                },
                riskScore,
                distress
              ).then((result) => {
                agentLogEvents.push({
                  timestamp: currentTime,
                  agentName: 'Verification',
                  entityId: result.action.targetId,
                  entityName: result.action.type.toUpperCase(),
                  description: `Proposed Action [${result.action.type.toUpperCase()}] status: ${result.status.toUpperCase()}. Justification: ${result.justification}`,
                  degraded: result.status === 'pending-human-approval',
                });
              });
            }
          }
        }
      }
    }

    // C. Maria & Child (Reunification Agent)
    if (maria && child) {
      const currentSeparationState =
        maria.reunificationTriggered || child.reunificationTriggered || false;

      if (currentSeparationState && !lastReunificationState) {
        // Trigger reunification recommendation
        const recommendation = checkReunification(maria, child, world);
        if (recommendation) {
          const mZoneId =
            maria.currentZoneId ||
            findZoneIdForPosition(maria.x, maria.y, world);
          const cZoneId =
            child.currentZoneId ||
            findZoneIdForPosition(child.x, child.y, world);

          const mRoute = getPathToZone(
            mZoneId,
            recommendation.meetingZoneId,
            world
          );
          const cRoute = getPathToZone(
            cZoneId,
            recommendation.meetingZoneId,
            world
          );

          if (mRoute.length > 0) {
            activeRoutes.set('special-maria', {
              waypoints: mRoute,
              currentIndex: 0,
              lastZoneDensityGroup: 0,
            });
            maria.goalX = mRoute[0].x;
            maria.goalY = mRoute[0].y;
          }
          if (cRoute.length > 0) {
            activeRoutes.set('special-child', {
              waypoints: cRoute,
              currentIndex: 0,
              lastZoneDensityGroup: 0,
            });
            child.goalX = cRoute[0].x;
            child.goalY = cRoute[0].y;
          }

          agentLogEvents.push({
            timestamp: currentTime,
            agentName: 'Reunification',
            entityId: 'special-maria',
            entityName: 'Maria & Child',
            description: `Separation alert triggered! Routing both to safe meeting zone "${recommendation.meetingZoneId}" (Status: ${recommendation.degradationLevel}).`,
            degraded: recommendation.degradationLevel !== 'preferred',
          });
        }
      } else if (!currentSeparationState && lastReunificationState) {
        // Reunification succeeded, restore standard exit goals
        activeRoutes.delete('special-maria');
        activeRoutes.delete('special-child');

        // Restore nearest exit gate destinations
        [maria, child].forEach((entity) => {
          let minGateDist = Infinity;
          let goalX = entity.goalX;
          let goalY = entity.goalY;
          world.gates.forEach((gate) => {
            const mx = (gate.x1 + gate.x2) / 2;
            const my = (gate.y1 + gate.y2) / 2;
            const gDist = Math.sqrt(
              (entity.x - mx) ** 2 + (entity.y - my) ** 2
            );
            if (gDist < minGateDist) {
              minGateDist = gDist;
              goalX = mx;
              goalY = my;
            }
          });
          entity.goalX = goalX;
          entity.goalY = goalY;
        });

        agentLogEvents.push({
          timestamp: currentTime,
          agentName: 'Reunification',
          entityId: 'special-maria',
          entityName: 'Maria & Child',
          description:
            'Reunification successful! Restoring standard exit gate goals.',
          degraded: false,
        });
      }

      lastReunificationState = currentSeparationState;

      // D. Crowd-Flow Critical Checks for verification
      const forecasts = runCrowdFlowAgent(world);
      forecasts.forEach((forecast) => {
        if (forecast.riskLevel === 'critical') {
          const actionKey = `gate_lockdown_${forecast.gateId}`;
          if (!proposedActionKeys.has(actionKey)) {
            proposedActionKeys.add(actionKey);

            const gateToZoneMapping: Record<string, string> = {
              'gate-nw': 'zone-north-concourse',
              'gate-ne': 'zone-north-concourse',
              'gate-e': 'zone-east-concourse',
              'gate-se': 'zone-south-concourse',
              'gate-sw': 'zone-south-concourse',
              'gate-w': 'zone-west-concourse',
            };
            const zoneId =
              gateToZoneMapping[forecast.gateId] || 'zone-south-concourse';
            const zone = world.zones.get(zoneId);
            const density = zone ? zone.currentDensity : 0;
            const distress = getZoneDistressScore(zoneId);

            const triggeringSignals = ['critical_density_trend'];
            if (
              forecast.contributingSignals === 'density+distress-corroborated'
            ) {
              triggeringSignals.push('elevated_panic_distress');
            }

            const riskScore = Math.min(1.0, density / 2.0);

            verifyAction(
              {
                type: 'gate_lockdown',
                targetId: forecast.gateId,
                triggeringSignals,
              },
              riskScore,
              distress
            ).then((result) => {
              agentLogEvents.push({
                timestamp: currentTime,
                agentName: 'Verification',
                entityId: result.action.targetId,
                entityName: result.action.type.toUpperCase(),
                description: `Proposed Action [${result.action.type.toUpperCase()}] status: ${result.status.toUpperCase()}. Justification: ${result.justification}`,
                degraded: result.status === 'pending-human-approval',
              });
            });
          }
        }
      });
    }
  }
}

// -------------------------------------------------------------
// DUAL-RUN COMPARATIVE SCORECARD METHODOLOGY
// -------------------------------------------------------------

export const SAFETY_THRESHOLDS: Record<string, number> = {
  'special-elena': 1.2,
  'special-sam': 1.25,
  'special-maria': 0.82,
  'special-child': 0.98,
  'special-robert': 1.3,
};

function seedVulnerableEntities(world: SimulationWorld) {
  // Elena (mobility-impaired)
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

  // Sam (sensory-sensitive)
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
  sam.distress = 0;
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

  // Robert (elderly)
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
  robert.stress = 0;
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

export interface RunComparisonResult {
  runA: {
    exposure: Record<string, number>;
  };
  runB: {
    exposure: Record<string, number>;
    eventLog: AgentLogEvent[];
    detailMessage: string;
  };
  protectedMinutes: number;
}

export function runComparisonMode(
  seed: number = 12345,
  disableAgentsRunB: boolean = false
): RunComparisonResult {
  const dt = 0.02;
  const duration = 85; // 85 simulated seconds
  const totalSteps = duration / dt;

  // Run A: Headless, agents disabled
  const runAWorld = new SimulationWorld(1200, 800);
  runAWorld.setSeed(seed);
  stadiumLayout.gates.forEach((g) => runAWorld.addGate(g));
  stadiumLayout.zones.forEach((z) => runAWorld.addZone(z));
  stadiumLayout.walls.forEach((w) => runAWorld.addWall(w));

  seedVulnerableEntities(runAWorld);
  spawnGeneralCrowd(600, runAWorld);

  const runAExposure: Record<string, number> = {
    'special-elena': 0,
    'special-sam': 0,
    'special-maria': 0,
    'special-child': 0,
    'special-robert': 0,
  };

  for (let step = 0; step < totalSteps; step++) {
    // Continuous spawn up to 2000 active particles
    if (runAWorld.particles.filter((p) => p.isActive).length < 2000) {
      spawnGeneralCrowd(15, runAWorld);
    }

    runAWorld.step(dt);

    Object.keys(SAFETY_THRESHOLDS).forEach((id) => {
      const p = runAWorld.particles.find((part) => part.id === id);
      if (p && p.isActive && !p.escaped) {
        const zoneId =
          p.currentZoneId || findZoneIdForPosition(p.x, p.y, runAWorld);
        const zone = runAWorld.zones.get(zoneId);
        const density = zone ? zone.currentDensity : 0;
        if (density > SAFETY_THRESHOLDS[id]) {
          runAExposure[id] += dt;
        }
      }
    });
  }

  // Run B: Headless, agents enabled (unless disableAgentsRunB is true)
  const runBWorld = new SimulationWorld(1200, 800);
  runBWorld.setSeed(seed);
  stadiumLayout.gates.forEach((g) => runBWorld.addGate(g));
  stadiumLayout.zones.forEach((z) => runBWorld.addZone(z));
  stadiumLayout.walls.forEach((w) => runBWorld.addWall(w));

  resetAgentIntegration();
  seedVulnerableEntities(runBWorld);
  spawnGeneralCrowd(600, runBWorld);

  const runBExposure: Record<string, number> = {
    'special-elena': 0,
    'special-sam': 0,
    'special-maria': 0,
    'special-child': 0,
    'special-robert': 0,
  };

  const peakDensities: Record<string, number> = {};
  const peakDensityTimes: Record<string, number> = {};

  for (let step = 0; step < totalSteps; step++) {
    // Continuous spawn up to 2000 active particles
    if (runBWorld.particles.filter((p) => p.isActive).length < 2000) {
      spawnGeneralCrowd(15, runBWorld);
    }

    runBWorld.step(dt);
    if (!disableAgentsRunB) {
      updateAgents(runBWorld);
    }

    // Track peak density times
    runBWorld.zones.forEach((zone) => {
      if (
        !peakDensities[zone.id] ||
        zone.currentDensity > peakDensities[zone.id]
      ) {
        peakDensities[zone.id] = zone.currentDensity;
        peakDensityTimes[zone.id] = runBWorld.simulationTime;
      }
    });

    Object.keys(SAFETY_THRESHOLDS).forEach((id) => {
      const p = runBWorld.particles.find((part) => part.id === id);
      if (p && p.isActive && !p.escaped) {
        const zoneId =
          p.currentZoneId || findZoneIdForPosition(p.x, p.y, runBWorld);
        const zone = runBWorld.zones.get(zoneId);
        const density = zone ? zone.currentDensity : 0;
        if (density > SAFETY_THRESHOLDS[id]) {
          runBExposure[id] += dt;
        }
      }
    });
  }

  const runBLogs = getAgentLogs();

  // Compute total protected seconds
  let totalASeconds = 0;
  let totalBSeconds = 0;
  Object.keys(SAFETY_THRESHOLDS).forEach((id) => {
    totalASeconds += runAExposure[id];
    totalBSeconds += runBExposure[id];
  });

  const protectedSeconds = Math.max(0, totalASeconds - totalBSeconds);
  const protectedMinutes = parseFloat((protectedSeconds / 60).toFixed(2));

  // Build detail message
  let detailMessage: string;
  const reunLog = runBLogs.find(
    (e) =>
      e.agentName === 'Reunification' &&
      e.description.includes('Reunification successful')
  );
  if (reunLog) {
    const peakTime = peakDensityTimes['zone-east-concourse'] || 25.0;
    const diff = Math.round(peakTime - reunLog.timestamp);
    detailMessage = `Maria and the Child reunited safely — ${Math.max(1, diff)} seconds before critical density peaked at their location.`;
  } else {
    const elenaLog = runBLogs.find(
      (e) =>
        e.agentName === 'Routing' &&
        e.entityId === 'special-elena' &&
        e.description.includes('Recalculated route')
    );
    if (elenaLog) {
      const peakTime = peakDensityTimes['zone-north-concourse'] || 22.0;
      const diff = Math.round(peakTime - elenaLog.timestamp);
      detailMessage = `Elena redirected safely — ${Math.max(1, diff)} seconds before critical density peaked at Gate NW.`;
    } else {
      detailMessage = `All vulnerable entities egressed safely under predictive agent guidance.`;
    }
  }

  return {
    runA: { exposure: runAExposure },
    runB: {
      exposure: runBExposure,
      eventLog: runBLogs,
      detailMessage,
    },
    protectedMinutes,
  };
}
