import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SimulationWorld } from './simulation/SimulationWorld';
import { Particle } from './simulation/Particle';
import { stadiumLayout } from './data/stadiumLayout';
import { runCrowdFlowAgent } from './agents/crowdFlow';
import type { CrowdFlowForecast } from './agents/crowdFlow';
import type {
  SimulationSnapshot,
  ParticleType,
  AgentLogEvent,
} from './simulation/types';
import {
  updateAgents,
  getAgentLogs,
  resetAgentIntegration,
  getActiveRoute,
  agentLogEvents,
  runComparisonMode,
  SAFETY_THRESHOLDS,
} from './simulation/agentIntegration';
import type { RunComparisonResult } from './simulation/agentIntegration';
import {
  getPendingApprovals,
  confirmAction,
  overrideAction,
} from './agents/verification';
import type { VerificationResult } from './agents/verification';

const SIM_WIDTH = 1200;
const SIM_HEIGHT = 800;

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  presetName: 'overview' | 'gate-focus' | 'entity-focus' | 'aftermath';
  focusTargetId?: string;
  isManual?: boolean;
}

interface HumanMomentNotification {
  id: string;
  name: string;
  initial: string;
  message: string;
  timestamp: string;
  isExiting: boolean;
}

const CAMERA_PRESETS = {
  overview: {
    x: 600,
    y: 400,
    zoom: 1.0,
    presetName: 'overview' as const,
    isManual: false,
  },
  aftermath: {
    x: 600,
    y: 400,
    zoom: 0.85,
    presetName: 'aftermath' as const,
    isManual: false,
  },
};

function getHumanFriendlyMessage(
  log: AgentLogEvent
): { name: string; initial: string; message: string } | null {
  const { agentName, entityId, description } = log;

  if (entityId === 'special-elena') {
    if (agentName === 'Routing' && description.includes('Recalculated route')) {
      return {
        name: 'Elena',
        initial: 'E',
        message:
          'Elena has found a new alternative route to bypass the crowded exit corridors.',
      };
    }
    if (
      agentName === 'Verification' &&
      description.includes('CRITICAL_REROUTING')
    ) {
      return {
        name: 'Elena',
        initial: 'E',
        message:
          'Elena faces highly congested paths; routing team has relaxations active to secure a fallback route.',
      };
    }
  }

  if (entityId === 'special-sam') {
    if (
      agentName === 'Routing' &&
      description.includes('Recalculated sensory-safe route')
    ) {
      return {
        name: 'Sam',
        initial: 'S',
        message:
          'Sam has been successfully rerouted to a quieter, sensory-safe concourse path.',
      };
    }
    if (
      agentName === 'Verification' &&
      description.includes('CRITICAL_REROUTING')
    ) {
      return {
        name: 'Sam',
        initial: 'S',
        message:
          'Sam reached high sensory thresholds; redirecting via safest fallback concourse.',
      };
    }
  }

  if (entityId === 'special-maria' || entityId === 'special-child') {
    if (agentName === 'Reunification') {
      if (description.includes('Separation alert')) {
        return {
          name: 'Maria & Child',
          initial: 'M',
          message:
            'Maria and her child have drifted apart. Reunification agent routing them to meeting point.',
        };
      }
      if (description.includes('Reunification successful')) {
        return {
          name: 'Maria & Child',
          initial: 'M',
          message:
            'Maria and her child have successfully reunited in the concourse exit queue.',
        };
      }
    }
  }

  return null;
}

export default function App() {
  // eslint-disable-next-line react-hooks/purity
  const reactStart = performance.now();
  const lastReactRenderTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<SimulationWorld | null>(null);
  const requestRef = useRef<number | null>(null);

  // UI state for HUD
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [forecasts, setForecasts] = useState<CrowdFlowForecast[]>([]);
  const [isSpawnActive, setIsSpawnActive] = useState(true);
  const [spawnType, setSpawnType] = useState<ParticleType | 'mixed'>('mixed');
  const [simulationSpeed, setSimulationSpeed] = useState(1); // multiplier
  const [selectedGate, setSelectedGate] = useState<string>('gate-nw');
  const [isMissionControlOpen, setIsMissionControlOpen] = useState(true);
  const [agentFilters, setAgentFilters] = useState<Record<string, boolean>>({
    'Crowd-Flow': true,
    Routing: true,
    Reunification: true,
    'Panic-Language': true,
    Verification: true,
  });
  const [pendingActions, setPendingActions] = useState<VerificationResult[]>(
    []
  );

  const [targetCamera, setTargetCamera] = useState<CameraState>({
    x: 600,
    y: 400,
    zoom: 1.0,
    presetName: 'overview',
    isManual: false,
  });

  const targetCameraRef = useRef(targetCamera);
  useEffect(() => {
    targetCameraRef.current = targetCamera;
  }, [targetCamera]);

  const cameraRef = useRef<CameraState>({
    x: 600,
    y: 400,
    zoom: 1.0,
    presetName: 'overview',
    isManual: false,
  });

  const lastProcessedLogRef = useRef<AgentLogEvent | null>(null);
  const distortionOverlayRef = useRef<HTMLDivElement>(null);
  const currentDistressRef = useRef(0);

  const [currentNotification, setCurrentNotification] =
    useState<HumanMomentNotification | null>(null);
  const notificationQueueRef = useRef<HumanMomentNotification[]>([]);
  const isNotificationActiveRef = useRef(false);

  const processNextNotification = () => {
    const next = notificationQueueRef.current.shift();
    if (next) {
      isNotificationActiveRef.current = true;
      setCurrentNotification(next);

      // Slide out after 4.4 seconds (hold 4s + 400ms slide in)
      setTimeout(() => {
        setCurrentNotification((curr) => {
          if (curr && curr.id === next.id) {
            return { ...curr, isExiting: true };
          }
          return curr;
        });

        // Completely remove and process next after 300ms slide out
        setTimeout(() => {
          setCurrentNotification((curr) => {
            if (curr && curr.id === next.id) {
              return null;
            }
            return curr;
          });
          isNotificationActiveRef.current = false;
          processNextNotification();
        }, 300);
      }, 4400);
    }
  };

  const queueNotification = (notif: HumanMomentNotification) => {
    notificationQueueRef.current.push(notif);
    if (!isNotificationActiveRef.current) {
      processNextNotification();
    }
  };

  const [isScorecardOpen, setIsScorecardOpen] = useState(false);
  const [scorecardData, setScorecardData] =
    useState<RunComparisonResult | null>(null);
  const [countUpMinutes, setCountUpMinutes] = useState(0);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isScorecardLoading, setIsScorecardLoading] = useState(false);

  const handleRunScorecard = () => {
    setIsScorecardLoading(true);
    setCountUpMinutes(0);

    // Timeout of 50ms yields a paint cycle for loading indicator to render before main thread freeze
    setTimeout(async () => {
      try {
        const results = await runComparisonMode(12345);
        setScorecardData(results);
        setIsScorecardOpen(true);

        const duration = 1200; // 1.2s count up duration
        const interval = 25;
        const steps = duration / interval;
        const stepVal = results.protectedMinutes / steps;
        let current = 0;
        let stepCount = 0;

        const timer = setInterval(() => {
          stepCount++;
          current += stepVal;
          if (stepCount >= steps) {
            clearInterval(timer);
            setCountUpMinutes(results.protectedMinutes);
          } else {
            setCountUpMinutes(parseFloat(current.toFixed(2)));
          }
        }, interval);
      } catch (err) {
        console.error('Error running comparative simulation:', err);
      } finally {
        setIsScorecardLoading(false);
      }
    }, 50);
  };

  const handleConfirmAction = (
    actionId: string,
    type: string,
    targetId: string
  ) => {
    confirmAction(actionId);
    setPendingActions(getPendingApprovals());
    const world = worldRef.current;
    const simTime = world ? world.simulationTime : 0;
    agentLogEvents.push({
      timestamp: simTime,
      agentName: 'Verification',
      entityId: targetId,
      entityName: type.toUpperCase(),
      description: `[VERIFICATION] Operator CONFIRMED action: ${type.toUpperCase()} on ${targetId}`,
      degraded: false,
    });
  };

  const handleOverrideAction = (
    actionId: string,
    type: string,
    targetId: string
  ) => {
    overrideAction(actionId);
    setPendingActions(getPendingApprovals());
    const world = worldRef.current;
    const simTime = world ? world.simulationTime : 0;
    agentLogEvents.push({
      timestamp: simTime,
      agentName: 'Verification',
      entityId: targetId,
      entityName: type.toUpperCase(),
      description: `[VERIFICATION] Operator OVERRIDDEN action: ${type.toUpperCase()} on ${targetId}`,
      degraded: true,
    });
  };

  // Create & initialize world
  const initWorld = () => {
    const world = new SimulationWorld(SIM_WIDTH, SIM_HEIGHT);
    resetAgentIntegration();

    // 1. Load Gates, Zones, and Walls dynamically from stadiumLayout
    stadiumLayout.gates.forEach((gate) => {
      world.addGate(gate);
    });

    stadiumLayout.zones.forEach((zone) => {
      world.addZone(zone);
    });

    stadiumLayout.walls.forEach((wall) => {
      world.addWall(wall);
    });

    worldRef.current = world;

    // 2. Seed the 5 named vulnerable entities deterministically
    seedVulnerableEntities(world);

    // 3. Prefill with some initial general crowd particles to start
    spawnGeneralCrowd(1000, world);
  };

  const seedVulnerableEntities = (world: SimulationWorld) => {
    // A. Elena (mobility-impaired): 0.4x speed
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
    elena.desiredSpeed = 14 * 0.4; // 0.4x speed
    world.addParticle(elena);

    // B. Sam (sensory-sensitive): sensoryThreshold = 1.8
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

    // C. Maria (guardian) & D. Child (unaccompanied-minor acting as child)
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

    // E. Robert (elderly): 0.6x speed
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
    robert.desiredSpeed = 16 * 0.6; // 0.6x speed
    robert.stress = 0;
    world.addParticle(robert);

    // Dynamically set initial exit goals for special particles
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
  };

  const spawnGeneralCrowd = (count: number, world: SimulationWorld) => {
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
      if (spawnType !== 'mixed') return spawnType;
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
      // Spawn in a ring representing seats: r in [180, 360]
      const angle = world.random() * Math.PI * 2;
      const rVal = 180 + world.random() * 180;
      const rx = 600 + rVal * Math.cos(angle);
      const ry = 400 + rVal * Math.sin(angle);

      // Find closest exit gate midpoint
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

      const pType = getRandomType();
      const id = `p-crowd-${world.particles.length}`;
      const p = new Particle(id, rx, ry, pType, goalX, goalY, () =>
        world.random()
      );

      // Spatial grid overlap prevention on spawn (O(1) instead of O(N))
      let overlaps = false;
      const queryRadius = p.radius + 12 + 2; // max other radius is 12
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
        world.spatialGrid.insert(p); // Insert immediately for subsequent batch checks
        spawned++;
      }
    }
  };

  const handleReset = () => {
    initWorld();
  };

  const handleSpawnBatch = (count: number) => {
    const world = worldRef.current;
    if (world) {
      spawnGeneralCrowd(count, world);
    }
  };

  const toggleGateOverload = (gateId: string) => {
    const world = worldRef.current;
    if (!world) return;
    const gate = world.gates.get(gateId);
    if (gate) {
      if (gate.overloaded) {
        gate.overloaded = false;
        gate.capacity = 15;
      } else {
        world.overloadGate(gateId);
      }
    }
  };

  const setGateCapacityDirectly = (gateId: string, cap: number) => {
    const world = worldRef.current;
    if (!world) return;
    world.setGateCapacity(gateId, cap);
  };

  // Main animation and physics tick loop
  useEffect(() => {
    initWorld();

    // eslint-disable-next-line react-hooks/purity
    let lastTime = performance.now();
    const fixedDt = 0.02; // 20ms steps
    let accumulator = 0;
    let frameCount = 0;
    // eslint-disable-next-line react-hooks/purity
    let lastFpsTime = performance.now();
    let currentFps = 60;
    let isSpawnThrottled = false;
    let lastStateUpdateTime = 0;
    let totalStepTime = 0;
    let totalAgentTime = 0;
    let totalDrawTime = 0;
    let framesThisSecond = 0;
    let stepCallsThisSecond = 0;
    // eslint-disable-next-line react-hooks/purity
    let lastLogTime = performance.now();

    const loop = () => {
      const world = worldRef.current;
      if (!world) return;

      const now = performance.now();

      // Resolve live target camera tracking coordinates
      const targetCam = targetCameraRef.current;
      let targetX = targetCam.x;
      let targetY = targetCam.y;
      const targetZoom = targetCam.zoom;

      if (targetCam.presetName === 'entity-focus') {
        const p = world.particles.find(
          (part) => part.id === targetCam.focusTargetId
        );
        if (p && !p.escaped) {
          targetX = p.x;
          targetY = p.y;
        }
      } else if (targetCam.presetName === 'gate-focus') {
        const gate = world.gates.get(targetCam.focusTargetId || '');
        if (gate) {
          targetX = (gate.x1 + gate.x2) / 2;
          targetY = (gate.y1 + gate.y2) / 2;
        }
      }

      // Smooth interpolation (lerp coefficient 0.08 ~ 600-800ms transition)
      const currentCam = cameraRef.current;
      currentCam.x += (targetX - currentCam.x) * 0.08;
      currentCam.y += (targetY - currentCam.y) * 0.08;
      currentCam.zoom += (targetZoom - currentCam.zoom) * 0.08;
      currentCam.presetName = targetCam.presetName;
      currentCam.focusTargetId = targetCam.focusTargetId;

      // Sensory Distortion Overlay Update (Sam's Distress)
      const sam = world.particles.find((p) => p.id === 'special-sam');
      const targetDistress =
        sam && sam.isActive && !sam.escaped ? sam.distress || 0 : 0;

      const distressDiff = targetDistress - currentDistressRef.current;
      if (distressDiff > 0) {
        currentDistressRef.current += distressDiff * 0.08; // Fast rise
      } else {
        currentDistressRef.current += distressDiff * 0.015; // Slow fade (~2-3s resolution)
      }

      const dVal = currentDistressRef.current;

      if (distortionOverlayRef.current) {
        if (dVal < 0.05) {
          distortionOverlayRef.current.style.opacity = '0';
        } else {
          distortionOverlayRef.current.style.opacity = '1';

          // Visual effect configuration based on distress
          const innerAlpha = Math.max(0, (dVal - 0.3) * 0.22); // subtle red glow
          const outerAlpha = Math.min(0.85, dVal * 0.85); // vignette edges opacity
          const innerR = Math.max(30, 60 - dVal * 30); // push gradient inward

          distortionOverlayRef.current.style.background = `radial-gradient(circle, transparent ${innerR}%, rgba(239, 68, 68, ${innerAlpha}) 70%, rgba(10, 5, 20, ${outerAlpha}) 100%)`;
          distortionOverlayRef.current.style.boxShadow = `inset 0 0 ${Math.round(dVal * 160)}px rgba(0, 0, 0, ${Math.min(0.95, dVal * 1.25)})`;

          // Custom properties driven pulse duration and blur scale
          const pulseDuration =
            dVal > 0.8 ? '1.8s' : dVal > 0.5 ? '2.8s' : '4.5s';
          distortionOverlayRef.current.style.setProperty(
            '--sam-distress',
            dVal.toFixed(4)
          );
          distortionOverlayRef.current.style.setProperty(
            '--pulse-duration',
            pulseDuration
          );
        }
      }

      const elapsed = (now - lastTime) / 1000;
      lastTime = now;

      let frameStepTime = 0;
      let frameAgentTime = 0;

      // Track rendering FPS
      frameCount++;
      if (now - lastFpsTime >= 1000) {
        currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        frameCount = 0;
        lastFpsTime = now;

        // Adaptive spawn throttle based on rendering FPS
        if (currentFps < 50) {
          isSpawnThrottled = true;
        } else if (currentFps >= 55) {
          isSpawnThrottled = false;
        }
      }

      // 1. Decoupled physics steps using accumulator pattern
      accumulator += elapsed * simulationSpeed;
      if (accumulator > 0.25) {
        accumulator = 0.25;
      }

      while (accumulator >= fixedDt) {
        // Auto spawn general crowd particles up to 2,000 limit with adaptive FPS throttle
        if (
          isSpawnActive &&
          !isSpawnThrottled &&
          world.particles.length < 2000
        ) {
          spawnGeneralCrowd(15, world);
        }

        // Dynamically update exit goals for active special entities based on proximity to exit gates
        // Check every 1.0 simulated seconds
        if (
          Math.floor(world.simulationTime) !==
          Math.floor(world.simulationTime - fixedDt)
        ) {
          const specialIds = ['special-robert'];
          specialIds.forEach((id) => {
            const p = world.particles.find((part) => part.id === id);
            if (p && p.isActive) {
              let minD = Infinity;
              let goalX = p.goalX;
              let goalY = p.goalY;
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

        const t0 = performance.now();
        world.step(fixedDt);
        const t1 = performance.now();
        updateAgents(world);
        const t2 = performance.now();

        frameStepTime += t1 - t0;
        frameAgentTime += t2 - t1;
        stepCallsThisSecond++;
        accumulator -= fixedDt;
      }

      totalStepTime += frameStepTime;
      totalAgentTime += frameAgentTime;

      // 2. Render Scene
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const drawStart = performance.now();
        ctx.fillStyle = '#0A0A0F';
        ctx.fillRect(0, 0, SIM_WIDTH, SIM_HEIGHT);

        const currentCam = cameraRef.current;
        ctx.save();
        ctx.translate(SIM_WIDTH / 2, SIM_HEIGHT / 2);
        ctx.scale(currentCam.zoom, currentCam.zoom);
        ctx.translate(-currentCam.x, -currentCam.y);

        // Throttle React state updates to 10fps (every 100ms) to avoid virtual DOM updates overhead
        const stateUpdateStart = performance.now();
        if (now - lastStateUpdateTime >= 100) {
          const snap = world.getSnapshot(currentFps);
          snap.agentLogs = getAgentLogs();
          setSnapshot(snap);
          const currentForecasts = runCrowdFlowAgent(world);
          setForecasts(currentForecasts);
          setPendingActions(getPendingApprovals());

          // Process new log events for notifications and camera tracking
          const allLogs = snap.agentLogs || [];
          const lastLog = lastProcessedLogRef.current;

          const newLogs = !lastLog
            ? allLogs
            : allLogs.slice(
                allLogs.findIndex(
                  (l) =>
                    l.timestamp === lastLog.timestamp &&
                    l.description === lastLog.description
                ) + 1
              );

          const activeTargetCam = targetCameraRef.current;

          if (newLogs.length > 0) {
            lastProcessedLogRef.current = newLogs[newLogs.length - 1];

            newLogs.forEach((log) => {
              // 1. Camera Auto-focus Trigger (only if NOT in manual mode)
              const isTargetEntity =
                log.entityId === 'special-elena' ||
                log.entityId === 'special-sam' ||
                log.entityId === 'special-maria' ||
                log.entityId === 'special-child';

              if (
                !activeTargetCam.isManual &&
                isTargetEntity &&
                (log.agentName === 'Routing' ||
                  log.agentName === 'Reunification' ||
                  log.agentName === 'Verification')
              ) {
                // Prioritize gate-focus over entity focus if critical forecast exists
                const criticalForecast = currentForecasts.find(
                  (f) => f.riskLevel === 'critical'
                );
                if (!criticalForecast) {
                  setTargetCamera({
                    x: 600,
                    y: 400,
                    zoom: 2.2,
                    presetName: 'entity-focus',
                    focusTargetId: log.entityId,
                    isManual: false,
                  });
                }
              }

              // 2. Human Moment Notification Trigger (always triggers)
              const humanMoment = getHumanFriendlyMessage(log);
              if (humanMoment) {
                queueNotification({
                  id: `hm-${log.timestamp}-${Math.random()}`,
                  name: humanMoment.name,
                  initial: humanMoment.initial,
                  message: humanMoment.message,
                  timestamp: `${log.timestamp.toFixed(1)}s`,
                  isExiting: false,
                });
              }
            });
          }

          // Camera Auto-focus for critical gate forecasts (only if NOT in manual mode)
          if (!activeTargetCam.isManual) {
            const criticalForecast = currentForecasts.find(
              (f) => f.riskLevel === 'critical'
            );
            if (
              criticalForecast &&
              activeTargetCam.presetName !== 'gate-focus'
            ) {
              setTargetCamera({
                x: 600,
                y: 400,
                zoom: 2.2,
                presetName: 'gate-focus',
                focusTargetId: criticalForecast.gateId,
                isManual: false,
              });
            }
          }

          lastStateUpdateTime = now;
        }
        const stateUpdateEnd = performance.now();

        // A. Draw Zones
        world.zones.forEach((zone) => {
          ctx.beginPath();
          ctx.moveTo(zone.points[0].x, zone.points[0].y);
          for (let i = 1; i < zone.points.length; i++) {
            ctx.lineTo(zone.points[i].x, zone.points[i].y);
          }
          ctx.closePath();

          const density = zone.currentDensity;
          if (density > 2.0) {
            ctx.fillStyle = 'rgba(220, 38, 38, 0.15)';
            ctx.strokeStyle = 'rgba(220, 38, 38, 0.4)';
          } else if (density > 1.0) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
          } else {
            ctx.fillStyle = 'rgba(45, 212, 191, 0.04)';
            ctx.strokeStyle = 'rgba(45, 212, 191, 0.15)';
          }
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.stroke();

          // Render Zone Tag
          ctx.fillStyle = '#6B7280';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          const minX = Math.min(...zone.points.map((p) => p.x));
          const minY = Math.min(...zone.points.map((p) => p.y));
          ctx.fillText(
            `${zone.name.split(' ')[0]}: ${density.toFixed(2)} p/m²`,
            minX + 15,
            minY + 25
          );
        });

        // B. Draw Walls
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        world.walls.forEach((wall) => {
          ctx.beginPath();
          ctx.moveTo(wall.x1, wall.y1);
          ctx.lineTo(wall.x2, wall.y2);
          ctx.stroke();
        });

        // C. Draw Gates
        world.gates.forEach((gate) => {
          ctx.lineWidth = 6;
          ctx.strokeStyle = gate.overloaded
            ? 'rgba(220, 38, 38, 0.85)'
            : 'rgba(34, 197, 94, 0.85)';

          ctx.beginPath();
          ctx.moveTo(gate.x1, gate.y1);
          ctx.lineTo(gate.x2, gate.y2);
          ctx.stroke();

          // Draw Gate text/stats
          const mx = (gate.x1 + gate.x2) / 2;
          const my = (gate.y1 + gate.y2) / 2;

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(gate.name.split(' ')[1] || '', mx, my - 22);
          ctx.fillStyle = gate.overloaded ? '#EF4444' : '#4ADE80';
          ctx.fillText(
            `Flow:${gate.currentThroughput.toFixed(1)}/s`,
            mx,
            my - 10
          );
        });

        // Group particles by color/type for efficient batch rendering
        const groups: Record<string, { color: string; particles: Particle[] }> =
          {
            general: { color: '#2DD4BF', particles: [] },
            'mobility-impaired': { color: '#A855F7', particles: [] },
            'sensory-sensitive': { color: '#3B82F6', particles: [] },
            elderly: { color: '#F97316', particles: [] },
            'unaccompanied-minor': { color: '#EC4899', particles: [] },
            guardian: { color: '#22C55E', particles: [] },
            escaped: { color: 'rgba(156, 163, 175, 0.3)', particles: [] },
          };

        world.particles.forEach((p) => {
          if (p.escaped) {
            groups.escaped.particles.push(p);
          } else {
            const type = p.type;
            if (groups[type]) {
              groups[type].particles.push(p);
            } else {
              groups.general.particles.push(p);
            }
          }
        });

        // Render each group in a single path
        Object.keys(groups).forEach((key) => {
          const group = groups[key];
          if (group.particles.length === 0) return;

          ctx.beginPath();
          ctx.fillStyle = group.color;

          group.particles.forEach((p) => {
            ctx.moveTo(p.x + p.radius, p.y);
            ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
          });

          ctx.fill();

          if (key !== 'general' && key !== 'escaped') {
            ctx.strokeStyle = '#05050A';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });

        // Finally, render outline highlights and labels for special particles
        world.particles.forEach((p) => {
          if (p.isSpecial) {
            if (p.escaped) {
              ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
              ctx.font = '9px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.fillText(`${p.name} (Escaped)`, p.x, p.y - p.radius - 8);
              return;
            }

            ctx.strokeStyle = p.reunificationTriggered ? '#EF4444' : '#FFFFFF';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius + 4, 0, 2 * Math.PI);
            ctx.stroke();

            // Label
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(p.name || '', p.x, p.y - p.radius - 8);
          }
        });

        ctx.restore();

        const drawEnd = performance.now();
        totalDrawTime +=
          drawEnd - drawStart - (stateUpdateEnd - stateUpdateStart);
      }

      framesThisSecond++;

      if (now - lastLogTime >= 1000) {
        const avgStep = totalStepTime / Math.max(1, stepCallsThisSecond);
        const avgAgent = totalAgentTime / Math.max(1, stepCallsThisSecond);
        const avgDraw = totalDrawTime / Math.max(1, framesThisSecond);
        const avgReact = lastReactRenderTimeRef.current;
        console.log(`[Frame Breakdown at ${world.simulationTime.toFixed(1)}s] Active Particles: ${world.particles.filter((p) => p.isActive).length} | FPS: ${currentFps}
  - world.step: ${avgStep.toFixed(3)} ms (avg per step)
  - updateAgents: ${avgAgent.toFixed(3)} ms (avg per step)
  - React render/state update: ${avgReact.toFixed(3)} ms (last render)
  - Canvas draw call: ${avgDraw.toFixed(3)} ms (avg per frame)`);

        totalStepTime = 0;
        totalAgentTime = 0;
        totalDrawTime = 0;
        framesThisSecond = 0;
        stepCallsThisSecond = 0;
        lastLogTime = now;
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpawnActive, spawnType, simulationSpeed]);

  const activeGateObj =
    snapshot?.gates.find((g) => g.id === selectedGate) || null;

  // Retrieve special entities state details for display
  const specialElena = snapshot?.particles.find(
    (p) => p.id === 'special-elena'
  );
  const specialSam = snapshot?.particles.find((p) => p.id === 'special-sam');
  const specialMaria = snapshot?.particles.find(
    (p) => p.id === 'special-maria'
  );
  const specialChild = snapshot?.particles.find(
    (p) => p.id === 'special-child'
  );
  const specialRobert = snapshot?.particles.find(
    (p) => p.id === 'special-robert'
  );

  // Compute separation distance for Maria and Child
  const separationDist =
    specialMaria &&
    specialChild &&
    !specialMaria.escaped &&
    !specialChild.escaped
      ? Math.sqrt(
          (specialMaria.x - specialChild.x) ** 2 +
            (specialMaria.y - specialChild.y) ** 2
        )
      : null;

  // eslint-disable-next-line react-hooks/refs, react-hooks/purity
  lastReactRenderTimeRef.current = performance.now() - reactStart;

  const getLogEntryColor = (agentName: string) => {
    switch (agentName) {
      case 'Crowd-Flow':
        return 'text-teal-400';
      case 'Routing':
        return 'text-purple-400';
      case 'Reunification':
        return 'text-emerald-400';
      case 'Panic-Language':
        return 'text-amber-400';
      case 'Verification':
        return 'text-red-400';
      default:
        return 'text-gray-300';
    }
  };

  const allEvents = snapshot?.agentLogs || [];
  const filteredEvents = allEvents.filter(
    (event) => agentFilters[event.agentName]
  );
  const reversedFilteredEvents = [...filteredEvents].reverse(); // newest at top
  const visibleEvents = reversedFilteredEvents.slice(0, 50);

  const getRouteStatus = (id: string) => {
    const route = getActiveRoute(id);
    if (!route) return 'Normal path';
    const isDegraded = route.waypoints.some((w) => w.isDegraded);
    return isDegraded ? 'Rerouting - degraded' : 'Rerouting - preferred';
  };

  return (
    <div className="flex flex-col xl:flex-row h-screen w-screen bg-[#0A0A0F] text-[#F3F4F6] font-sans overflow-hidden">
      {/* Left: Simulation Viewport (Normal document flow, vertically stacked, naturally scrolling) */}
      <div className="flex-1 overflow-y-auto bg-[#050508] p-6 flex flex-col items-center space-y-6 scrollbar-thin relative">
        {/* Real-time Telemetry Dashboard Panel */}
        {snapshot && (
          <div className="w-full max-w-[1200px] bg-[#0E0E15]/95 border border-[#1E1E2E] p-4 rounded-md font-mono text-xs shadow-lg backdrop-blur-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 flex-shrink-0">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="text-[#2DD4BF] font-extrabold text-sm tracking-wider">
                SYSTEM TELEMETRY
              </div>
              <div className="flex flex-wrap gap-4 text-gray-300">
                <div>
                  FPS:{' '}
                  <span className="text-[#4ADE80] font-bold">
                    {snapshot.stats.fps}
                  </span>
                </div>
                <div>
                  Sim Time:{' '}
                  <span className="text-teal-400 font-bold">
                    {snapshot.stats.elapsedTime.toFixed(1)}s
                  </span>
                </div>
                <div>
                  Active Crowd:{' '}
                  <span className="text-amber-400 font-bold">
                    {snapshot.stats.activeParticles} / 2000
                  </span>
                </div>
                <div>
                  Egressed Agents:{' '}
                  <span className="text-emerald-400 font-bold">
                    {snapshot.stats.totalEscaped}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-400 text-[10px] border-t md:border-t-0 md:border-l border-gray-800 pt-2 md:pt-0 md:pl-4">
              {snapshot.zones.map((z) => (
                <div key={z.id} className="flex space-x-1.5">
                  <span className="font-semibold">{z.name.split(' ')[0]}:</span>
                  <span
                    className={
                      z.density > 2.0
                        ? 'text-red-500 font-bold'
                        : z.density > 1.0
                          ? 'text-amber-500 font-medium'
                          : 'text-emerald-400'
                    }
                  >
                    {z.density.toFixed(2)} p/m²
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Breathing Map Canvas Wrapper */}
        <div className="relative w-full max-w-[1200px] aspect-[3/2] bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg shadow-2xl overflow-hidden cursor-pointer flex items-center justify-center flex-shrink-0">
          <canvas
            ref={canvasRef}
            width={SIM_WIDTH}
            height={SIM_HEIGHT}
            onClick={() => setTargetCamera(CAMERA_PRESETS.overview)}
            className="w-full h-full object-contain"
          />
          <div
            ref={distortionOverlayRef}
            className="absolute inset-0 pointer-events-none rounded-lg z-10 sensory-distortion-overlay"
          />

          {/* Human Moment Notification Overlay (Top-Right of Map Viewport) */}
          <AnimatePresence>
            {currentNotification && !currentNotification.isExiting && (
              <motion.div
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="absolute top-4 right-4 z-20 w-80 bg-[#12121A]/95 border border-[#1E1E2E] p-3.5 rounded-xl shadow-2xl flex items-start space-x-3 backdrop-blur-md pointer-events-auto font-sans text-left"
              >
                {/* App-icon avatar circle */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm bg-gradient-to-br from-teal-500/20 to-teal-400/5 border border-teal-500/30 text-teal-400 shadow-inner flex-shrink-0">
                  {currentNotification.initial}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between items-baseline">
                    <span className="font-semibold text-xs text-teal-400 tracking-wide uppercase">
                      System Alert
                    </span>
                    <span className="text-[9px] text-gray-500 font-mono">
                      {currentNotification.timestamp}
                    </span>
                  </div>
                  <div className="font-bold text-xs text-gray-200">
                    {currentNotification.name}
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed font-mono">
                    {currentNotification.message}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Camera Preset Control Bar */}
        <div className="w-full max-w-[1200px] bg-[#0E0E15]/95 border border-[#1E1E2E] p-3 rounded-lg shadow-lg backdrop-blur-sm flex items-center justify-between font-mono text-xs flex-shrink-0">
          <span className="text-gray-500 font-bold uppercase tracking-wider text-[10px]">
            CAMERA VIEW PRESETS:
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() =>
                setTargetCamera({ ...CAMERA_PRESETS.overview, isManual: true })
              }
              className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
                targetCamera.presetName === 'overview'
                  ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              OVERVIEW
            </button>
            <button
              onClick={() => {
                setTargetCamera({
                  x: 600,
                  y: 400,
                  zoom: 2.2,
                  presetName: 'entity-focus',
                  focusTargetId: 'special-elena',
                  isManual: true,
                });
              }}
              className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
                targetCamera.presetName === 'entity-focus' &&
                targetCamera.focusTargetId === 'special-elena'
                  ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              ELENA
            </button>
            <button
              onClick={() => {
                setTargetCamera({
                  x: 600,
                  y: 400,
                  zoom: 2.2,
                  presetName: 'entity-focus',
                  focusTargetId: 'special-sam',
                  isManual: true,
                });
              }}
              className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
                targetCamera.presetName === 'entity-focus' &&
                targetCamera.focusTargetId === 'special-sam'
                  ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              SAM
            </button>
            <button
              onClick={() => {
                setTargetCamera({
                  x: 600,
                  y: 400,
                  zoom: 2.2,
                  presetName: 'entity-focus',
                  focusTargetId: 'special-maria',
                  isManual: true,
                });
              }}
              className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
                targetCamera.presetName === 'entity-focus' &&
                (targetCamera.focusTargetId === 'special-maria' ||
                  targetCamera.focusTargetId === 'special-child')
                  ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              MARIA
            </button>
            <button
              onClick={() =>
                setTargetCamera({ ...CAMERA_PRESETS.aftermath, isManual: true })
              }
              className={`px-2.5 py-1 rounded border transition font-bold cursor-pointer ${
                targetCamera.presetName === 'aftermath'
                  ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                  : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
              }`}
            >
              AFTERMATH
            </button>
          </div>
        </div>

        {/* Operator Decision Console (In-flow) */}
        <div className="w-full max-w-[1200px] bg-[#0E0E15]/95 border border-[#1E1E2E] p-5 rounded-lg shadow-lg backdrop-blur-sm flex flex-col font-mono text-xs flex-shrink-0">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <h2 className="text-sm font-bold text-red-500 tracking-wider uppercase">
                Operator Decision Console
              </h2>
            </div>
            <span className="text-xs bg-red-950/40 border border-red-900/40 text-red-400 px-2 py-0.5 rounded-full font-bold">
              {pendingActions.length} PENDING ACTION(S)
            </span>
          </div>

          <div className="h-px bg-gray-800 mb-4" />

          {/* Actions List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence initial={false}>
              {pendingActions.map((item) => {
                const conf = item.confidence;
                const ringColor =
                  conf > 85 ? '#EF4444' : conf >= 70 ? '#F59E0B' : '#2DD4BF';

                const radius = 18;
                const circumference = 2 * Math.PI * radius;
                const strokeDashoffset =
                  circumference - (conf / 100) * circumference;

                return (
                  <motion.div
                    key={item.action.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="border border-[#1E1E2E] bg-[#0B0B10] p-4 rounded-lg flex flex-col justify-between space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="text-red-400 font-bold text-xs uppercase">
                          {item.action.type.replace(/_/g, ' ')}
                        </div>
                        <div className="text-gray-500 text-[10px]">
                          Target: {item.action.targetId}
                        </div>
                      </div>

                      {/* Radial Progress Circle */}
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] text-gray-400 font-bold">
                          {conf}%
                        </span>
                        <svg className="w-10 h-10 transform -rotate-90">
                          <circle
                            cx="20"
                            cy="20"
                            r={radius}
                            stroke="#1E1E2E"
                            strokeWidth="3.5"
                            fill="transparent"
                          />
                          <circle
                            cx="20"
                            cy="20"
                            r={radius}
                            stroke={ringColor}
                            strokeWidth="3.5"
                            fill="transparent"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            strokeLinecap="round"
                            className="transition-all duration-300"
                          />
                        </svg>
                      </div>
                    </div>

                    <p className="text-[10px] text-gray-400 italic leading-relaxed bg-[#0F0F16] p-2 rounded border border-[#1E1E2E]">
                      "{item.justification}"
                    </p>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() =>
                          handleConfirmAction(
                            item.action.id,
                            item.action.type,
                            item.action.targetId
                          )
                        }
                        className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-[10px] transition cursor-pointer text-center"
                      >
                        CONFIRM
                      </button>
                      <button
                        onClick={() =>
                          handleOverrideAction(
                            item.action.id,
                            item.action.type,
                            item.action.targetId
                          )
                        }
                        className="py-1.5 px-3 border border-red-500/50 hover:bg-red-950/20 text-red-400 font-bold rounded text-[10px] transition cursor-pointer text-center"
                      >
                        OVERRIDE
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {pendingActions.length === 0 && (
              <div className="col-span-1 md:col-span-2 text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 rounded p-4 text-center text-xs font-semibold flex items-center justify-center space-x-2 py-6">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>NO PENDING ACTIONS — SYSTEM NOMINAL</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Control Panel Panel */}
      <div className="w-full xl:w-[420px] border-t xl:border-t-0 xl:border-l border-[#1E1E2E] bg-[#0A0A0F] p-6 flex flex-col justify-between overflow-y-auto min-h-[300px] xl:min-h-0">
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl font-extrabold text-[#2DD4BF] tracking-tight">
                UNDERTOW
              </h1>
              <p className="text-xs text-gray-500 mt-1 font-mono">
                Predictive Stadium Egress Sandbox
              </p>
            </div>
            <div className="flex space-x-1.5">
              <button
                onClick={() => setIsFocusMode(!isFocusMode)}
                className={`py-1 px-2.5 text-[9px] font-mono rounded border transition cursor-pointer font-bold ${
                  isFocusMode
                    ? 'bg-amber-500/10 border-amber-500/80 text-amber-400'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:text-gray-300'
                }`}
              >
                FOCUS MODE: {isFocusMode ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={handleRunScorecard}
                className="py-1 px-2.5 text-[9px] font-mono rounded bg-teal-500/10 border border-teal-500/60 text-[#2DD4BF] hover:bg-teal-500 hover:text-white font-bold transition cursor-pointer"
              >
                RUN SCORECARD
              </button>
              <button
                onClick={() => setIsMissionControlOpen(!isMissionControlOpen)}
                className="py-1 px-2.5 text-[9px] font-mono rounded bg-gray-900 border border-gray-800 text-[#2DD4BF] hover:text-teal-300 font-bold transition hover:bg-gray-800 cursor-pointer"
              >
                {isMissionControlOpen ? 'HIDE LOGS' : 'SHOW LOGS'}
              </button>
            </div>
          </div>

          <motion.div
            initial={false}
            animate={{
              height: isFocusMode ? 0 : 'auto',
              opacity: isFocusMode ? 0 : 1,
            }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="overflow-hidden flex flex-col space-y-6"
          >
            <div className="h-px bg-gray-800" />

            {/* Crowd-Flow Predictor forecasts */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-300 font-mono">
                1. CROWD-FLOW FORECAST
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {forecasts.map((forecast) => {
                  let riskColor =
                    'text-emerald-400 bg-emerald-950/40 border-emerald-800';
                  if (forecast.riskLevel === 'critical') {
                    riskColor =
                      'text-red-400 bg-red-950/40 border-red-800 font-bold pulse-glow';
                  } else if (forecast.riskLevel === 'high') {
                    riskColor =
                      'text-orange-400 bg-orange-950/40 border-orange-800';
                  } else if (forecast.riskLevel === 'medium') {
                    riskColor =
                      'text-yellow-400 bg-yellow-950/40 border-yellow-800';
                  }

                  let etaStr: string;
                  if (forecast.etaToOverloadSeconds === Infinity) {
                    etaStr = 'STABLE';
                  } else if (forecast.etaToOverloadSeconds === 0) {
                    etaStr = 'OVERLOADED';
                  } else if (forecast.etaToOverloadSeconds < 0.1) {
                    etaStr = '< 0.1s';
                  } else {
                    etaStr = `${forecast.etaToOverloadSeconds.toFixed(1)}s`;
                  }

                  return (
                    <div
                      key={forecast.gateId}
                      className={`p-2 border rounded font-mono text-[10px] flex flex-col justify-between ${riskColor}`}
                    >
                      <div className="font-bold uppercase">
                        {forecast.gateId.toUpperCase()}
                      </div>
                      <div className="mt-1">
                        Risk:{' '}
                        <span className="uppercase">{forecast.riskLevel}</span>
                      </div>
                      <div>ETA: {etaStr}</div>
                      {forecast.contributingSignals && (
                        <div className="text-[8px] opacity-75 mt-1 border-t border-current/10 pt-1 uppercase">
                          Src: {forecast.contributingSignals.replace(/-/g, ' ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>

          <div className="h-px bg-gray-800" />

          {/* Vulnerable Entities HUD Details */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-300 font-mono">
              2. VULNERABLE ENTITIES STATE
            </h2>
            <div className="space-y-2 font-mono text-xs">
              {/* Elena */}
              {specialElena && (
                <div className="bg-[#111116] border border-gray-800 p-2.5 rounded flex justify-between items-center">
                  <div>
                    <span className="text-[#A855F7] font-bold">Elena</span>{' '}
                    (Mobility Impaired)
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Zone:{' '}
                      {specialElena.currentZoneId
                        ? specialElena.currentZoneId
                            .replace('zone-', '')
                            .toUpperCase()
                        : 'OUTSIDE'}
                    </div>
                  </div>
                  <div className="text-right">
                    {specialElena.escaped ? (
                      <span className="text-[#4ADE80] font-bold">
                        EGRESSED SAFELY
                      </span>
                    ) : (
                      <>
                        <div className="text-[10px]">
                          Speed: {specialElena.desiredSpeed.toFixed(1)} px/s
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {getRouteStatus('special-elena')}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Sam */}
              {specialSam && (
                <div className="bg-[#111116] border border-gray-800 p-2.5 rounded flex justify-between items-center">
                  <div>
                    <span className="text-[#3B82F6] font-bold">Sam</span>{' '}
                    (Sensory Sensitive)
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Zone:{' '}
                      {specialSam.currentZoneId
                        ? specialSam.currentZoneId
                            .replace('zone-', '')
                            .toUpperCase()
                        : 'OUTSIDE'}
                    </div>
                  </div>
                  <div className="text-right">
                    {specialSam.escaped ? (
                      <span className="text-[#4ADE80] font-bold">
                        EGRESSED SAFELY
                      </span>
                    ) : (
                      <div className="text-xs">
                        Distress:{' '}
                        <span
                          className={
                            (specialSam.distress || 0) > 0.7
                              ? 'text-red-500 font-bold'
                              : (specialSam.distress || 0) > 0.3
                                ? 'text-yellow-400'
                                : 'text-emerald-400'
                          }
                        >
                          {Math.round((specialSam.distress || 0) * 100)}%
                        </span>
                        <div className="text-[10px] text-gray-400 mt-1">
                          {getRouteStatus('special-sam')}
                        </div>
                        <div className="text-[9px] text-[#2DD4BF] mt-1 flex items-center justify-end space-x-1 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF] animate-ping" />
                          <span>Sensory Load: rendering live</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Maria & Child */}
              {specialMaria && specialChild && (
                <div className="bg-[#111116] border border-gray-800 p-2.5 rounded space-y-1.5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-[#22C55E] font-bold">
                        Maria & Child
                      </span>{' '}
                      (Guardian Pair)
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {specialMaria.escaped &&
                          !specialChild.escaped &&
                          'Maria Egressed / Child Active'}
                        {!specialMaria.escaped &&
                          specialChild.escaped &&
                          'Child Egressed / Maria Active'}
                        {!specialMaria.escaped && !specialChild.escaped && (
                          <>
                            Zone:{' '}
                            {specialMaria.currentZoneId
                              ? specialMaria.currentZoneId
                                  .replace('zone-', '')
                                  .toUpperCase()
                              : 'OUTSIDE'}
                          </>
                        )}
                        {specialMaria.escaped &&
                          specialChild.escaped &&
                          'OUTSIDE'}
                      </div>
                    </div>
                    <div className="text-right">
                      {specialMaria.escaped && specialChild.escaped ? (
                        <span className="text-[#4ADE80] font-bold">
                          EGRESSED SAFELY
                        </span>
                      ) : (
                        <div className="text-xs">
                          Gap:{' '}
                          <span
                            className={
                              specialMaria.reunificationTriggered
                                ? 'text-red-500 font-bold pulse-text'
                                : 'text-emerald-400'
                            }
                          >
                            {separationDist
                              ? `${(separationDist / 20).toFixed(2)}m`
                              : 'N/A'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {specialMaria.reunificationTriggered && (
                    <div className="text-[10px] text-red-500 border border-red-950 bg-red-950/20 px-2 py-0.5 rounded font-bold text-center">
                      CRITICAL SEPARATION DETECTED (REUNIFICATION FLAG ACTIVE)
                    </div>
                  )}
                </div>
              )}

              {/* Robert */}
              {specialRobert && (
                <div className="bg-[#111116] border border-gray-800 p-2.5 rounded flex justify-between items-center">
                  <div>
                    <span className="text-[#F97316] font-bold">Robert</span>{' '}
                    (Elderly)
                  </div>
                  <div className="text-right">
                    {specialRobert.escaped ? (
                      <span className="text-[#4ADE80] font-bold">
                        EGRESSED SAFELY
                      </span>
                    ) : (
                      <div className="text-xs">
                        Stress:{' '}
                        <span
                          className={
                            (specialRobert.stress || 0) > 0.8
                              ? 'text-red-500 font-bold'
                              : (specialRobert.stress || 0) > 0.4
                                ? 'text-yellow-400'
                                : 'text-emerald-400'
                          }
                        >
                          {Math.round((specialRobert.stress || 0) * 100)}%
                        </span>
                        {(specialRobert.stress || 0) > 0.8 && (
                          <div className="text-[8px] text-red-400 font-bold mt-0.5">
                            SPEED REDUCED (0.3x)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-gray-800" />

          {/* Interactive Gate Controllers */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-300 font-mono">
              3. BOTTLENECK & GATE CONTROL
            </h2>

            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-mono">
                SELECT EXIT GATE
              </label>
              <select
                value={selectedGate}
                onChange={(e) => setSelectedGate(e.target.value)}
                className="w-full bg-[#111116] border border-gray-800 p-2 rounded text-xs font-mono focus:outline-none focus:border-teal-500"
              >
                {Array.from(stadiumLayout.gates).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {activeGateObj && (
              <div className="bg-[#111116] border border-gray-800 p-3 rounded space-y-3">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-gray-400">Name:</span>
                  <span className="font-bold text-[#F3F4F6]">
                    {activeGateObj.name}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                    <span>GATE CAPACITY ({activeGateObj.capacity} p/s)</span>
                    {activeGateObj.overloaded && (
                      <span className="text-red-500 font-bold">
                        OVERLOAD THROTTLE
                      </span>
                    )}
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={activeGateObj.capacity}
                    onChange={(e) =>
                      setGateCapacityDirectly(
                        selectedGate,
                        parseInt(e.target.value)
                      )
                    }
                    className="w-full accent-teal-500 cursor-pointer bg-gray-800 h-1 rounded"
                  />
                </div>

                <button
                  onClick={() => toggleGateOverload(selectedGate)}
                  className={`w-full py-2 text-xs font-mono rounded font-bold transition border ${
                    activeGateObj.overloaded
                      ? 'bg-red-500 text-white hover:bg-red-600 border-red-600'
                      : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-red-400 hover:text-red-300'
                  }`}
                >
                  {activeGateObj.overloaded
                    ? 'DISABLE OVERLOAD'
                    : 'FORCE OVERLOAD (CRITICAL BACKLOG)'}
                </button>
              </div>
            )}
          </div>

          <div className="h-px bg-gray-800" />

          {/* Particle Spawn Controls */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-300 font-mono">
              4. SPONSOR & SPEED
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsSpawnActive(!isSpawnActive)}
                className={`py-2 px-3 text-xs font-mono rounded font-bold border transition ${
                  isSpawnActive
                    ? 'bg-teal-500/10 border-teal-500 text-teal-400'
                    : 'bg-gray-800/40 border-gray-700 text-gray-400'
                }`}
              >
                {isSpawnActive ? 'AUTO-SPAWN: ON' : 'AUTO-SPAWN: OFF'}
              </button>
              <button
                onClick={() => handleSpawnBatch(500)}
                className="py-2 px-3 text-xs font-mono rounded bg-gray-800 hover:bg-gray-700 border border-gray-700 font-bold transition text-gray-200"
              >
                SPAWN +500 BATCH
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 font-mono">
                SPAWN FILTER TYPE
              </label>
              <select
                value={spawnType}
                onChange={(e) =>
                  setSpawnType(e.target.value as ParticleType | 'mixed')
                }
                className="w-full bg-[#111116] border border-gray-800 p-2 rounded text-xs font-mono focus:outline-none focus:border-teal-500"
              >
                <option value="mixed">Mixed Demographics (Balanced)</option>
                <option value="general">General Public (Teal)</option>
                <option value="mobility-impaired">
                  Mobility Impaired (Purple)
                </option>
                <option value="sensory-sensitive">
                  Sensory Sensitive (Blue)
                </option>
                <option value="elderly">Elderly (Orange)</option>
                <option value="unaccompanied-minor">
                  Unaccompanied Minor (Pink)
                </option>
                <option value="guardian">Guardian (Green)</option>
              </select>
            </div>

            <div className="space-y-1 pt-1">
              <label className="text-[10px] text-gray-500 font-mono">
                SIMULATION SPEED
              </label>
              <div className="grid grid-cols-4 gap-1">
                {[0.5, 1, 2, 4].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => setSimulationSpeed(speed)}
                    className={`py-1 px-2 text-xs font-mono rounded border transition ${
                      simulationSpeed === speed
                        ? 'bg-teal-500/10 border-teal-500 text-teal-400 font-bold'
                        : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-2">
          <button
            onClick={handleReset}
            className="w-full py-2.5 rounded bg-[#DC2626] hover:bg-red-700 font-mono text-xs font-bold text-white transition shadow-md"
          >
            RESET SIMULATION
          </button>
          <div className="text-[10px] text-gray-500 font-mono text-center">
            Scale: 1m = 20px | Bottleneck testing sandboxed.
          </div>
        </div>
      </div>

      {/* Far Right: Mission Control Panel (Collapsible with smooth animation) */}
      <AnimatePresence>
        {isMissionControlOpen && !isFocusMode && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="w-full xl:w-[380px] border-t xl:border-t-0 xl:border-l border-[#1E1E2E] bg-[#12121A] flex flex-col font-mono text-xs h-full overflow-hidden flex-shrink-0"
          >
            {/* Fixed width content wrapper to prevent wrapping during width collapse */}
            <div className="w-[380px] p-4 flex flex-col h-full overflow-hidden flex-shrink-0">
              {/* Header */}
              <div className="flex justify-between items-center mb-3 flex-shrink-0">
                <h2 className="text-sm font-semibold text-gray-300">
                  MISSION CONTROL LOG
                </h2>
                <span className="text-[10px] bg-gray-950 border border-gray-900 text-teal-400 px-2 py-0.5 rounded-full font-bold">
                  {allEvents.length} EVENTS
                </span>
              </div>

              {/* Filter toggle checkboxes/buttons */}
              <div className="flex flex-wrap gap-1 mb-3 flex-shrink-0">
                {Object.keys(agentFilters).map((agent) => {
                  const active = agentFilters[agent];
                  let activeStyle = '';
                  if (active) {
                    if (agent === 'Crowd-Flow')
                      activeStyle =
                        'bg-teal-500/10 border border-teal-500 text-teal-400 font-bold';
                    else if (agent === 'Routing')
                      activeStyle =
                        'bg-purple-500/10 border border-purple-500 text-purple-400 font-bold';
                    else if (agent === 'Reunification')
                      activeStyle =
                        'bg-emerald-500/10 border border-emerald-500 text-emerald-400 font-bold';
                    else if (agent === 'Panic-Language')
                      activeStyle =
                        'bg-amber-500/10 border border-amber-500 text-amber-400 font-bold';
                    else if (agent === 'Verification')
                      activeStyle =
                        'bg-red-500/10 border border-red-500 text-red-400 font-bold';
                  } else {
                    activeStyle =
                      'bg-gray-950 border border-gray-900 text-gray-600';
                  }
                  return (
                    <button
                      key={agent}
                      onClick={() =>
                        setAgentFilters((prev) => ({
                          ...prev,
                          [agent]: !prev[agent],
                        }))
                      }
                      className={`px-2 py-0.5 text-[8px] rounded transition cursor-pointer ${activeStyle}`}
                    >
                      {agent.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              <div className="h-px bg-gray-950 mb-3 flex-shrink-0" />

              {/* Logs List Container */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                <AnimatePresence initial={false}>
                  {visibleEvents.map((event) => (
                    <motion.div
                      key={`${event.timestamp}_${event.agentName}_${event.description}`}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className={`py-1.5 border-b border-gray-950 last:border-0 overflow-hidden leading-normal ${getLogEntryColor(
                        event.agentName
                      )}`}
                    >
                      <span className="text-[10px] opacity-40 mr-1.5">
                        [{event.timestamp.toFixed(1)}s]
                      </span>
                      <span className="font-bold mr-1.5">
                        [{event.agentName.toUpperCase()}]
                      </span>
                      <span>{event.description}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {visibleEvents.length === 0 && (
                  <div className="text-gray-600 text-center py-8">
                    NO ACTIVE LOGS FOR SELECTED FILTERS
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparative Scorecard Loading State */}
      <AnimatePresence>
        {isScorecardLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md pointer-events-auto"
          >
            <div className="flex flex-col items-center space-y-4 font-mono text-xs">
              {/* Spinner */}
              <div className="relative w-12 h-12 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-teal-500/20" />
                <div className="absolute inset-0 rounded-full border-4 border-t-teal-400 animate-spin" />
              </div>
              <div className="text-teal-400 font-bold uppercase tracking-wider text-center">
                Running Comparative Simulation
              </div>
              <div className="text-gray-500 text-[10px] text-center max-w-[280px]">
                Calculating safety envelopes for 2,000 agents over dual
                85-second evac runs...
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparative Scorecard Modal */}
      <AnimatePresence>
        {isScorecardOpen && scorecardData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-[600px] bg-[#0E0E15]/95 border border-[#1E1E2E] rounded-2xl shadow-2xl p-6 relative font-sans text-gray-200 backdrop-blur-md"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-sm font-bold text-teal-400 tracking-wider uppercase font-mono flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                  <span>Predictive Egress Scorecard</span>
                </h2>
                <button
                  onClick={() => setIsScorecardOpen(false)}
                  className="text-gray-500 hover:text-gray-300 font-bold transition text-xs font-mono border border-gray-800 hover:border-gray-700 px-2 py-0.5 rounded cursor-pointer"
                >
                  CLOSE
                </button>
              </div>

              <div className="h-px bg-gray-850 mb-6" />

              {/* Large Metric: Protected Minutes */}
              <div className="text-center space-y-2 mb-8">
                <div className="text-[10px] text-gray-400 tracking-widest uppercase font-mono">
                  Total Safety Margin Secured
                </div>
                <div className="text-5xl font-extrabold text-teal-400 tracking-tight font-mono">
                  {countUpMinutes.toFixed(2)}
                  <span className="text-lg font-bold text-gray-400 ml-1.5 lowercase">
                    min
                  </span>
                </div>
                <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                  Cumulative duration of unsafe crowd density exposure avoided
                  across all named entities.
                </p>
              </div>

              {/* Entity Breakdown Table */}
              <div className="space-y-3 mb-8">
                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">
                  Unsafe Exposure Breakdown (Run A vs Run B)
                </h3>
                <div className="bg-[#07070B] border border-[#1E1E2E] rounded-lg overflow-hidden font-mono text-xs">
                  <div className="grid grid-cols-3 bg-[#111116] p-2.5 font-bold text-gray-400 border-b border-gray-850 text-[10px]">
                    <div>ENTITY</div>
                    <div className="text-center">UNASSISTED (RUN A)</div>
                    <div className="text-center text-teal-400">
                      GUIDED (RUN B)
                    </div>
                  </div>

                  {Object.keys(SAFETY_THRESHOLDS).map((id) => {
                    const nameMapping: Record<string, string> = {
                      'special-elena': 'Elena',
                      'special-sam': 'Sam',
                      'special-maria': 'Maria',
                      'special-child': 'Child',
                      'special-robert': 'Robert',
                    };
                    const name = nameMapping[id] || id;

                    const expA = scorecardData.runA.exposure[id] || 0;
                    const expB = scorecardData.runB.exposure[id] || 0;

                    return (
                      <div
                        key={id}
                        className="grid grid-cols-3 p-2.5 border-b border-gray-900/60 last:border-0 items-center"
                      >
                        <div className="font-bold text-gray-300">{name}</div>
                        <div className="text-center text-red-400/95">
                          {expA.toFixed(1)}s
                        </div>
                        <div className="text-center text-teal-400 font-bold">
                          {expB.toFixed(1)}s
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-gray-900 mb-6" />

              {/* Closing Human-Scale Static Detail */}
              <div className="bg-teal-950/15 border border-teal-900/40 rounded-lg p-4 text-center">
                <p className="text-xs text-[#2DD4BF] leading-relaxed italic">
                  "{scorecardData.runB.detailMessage}"
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
