import { SimulationWorld } from '../simulation/SimulationWorld';
import { Particle } from '../simulation/Particle';

export interface ReunificationRecommendation {
  meetingZoneId: string;
  guardianGoal: { x: number; y: number };
  childGoal: { x: number; y: number };
  degradationLevel: 'preferred' | 'relaxed' | 'unconstrained';
}

// Zone physical centers (same as routing.ts)
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

export function checkReunification(
  guardian: Particle,
  child: Particle,
  world: SimulationWorld,
  options?: { densityThreshold?: number }
): ReunificationRecommendation | null {
  // 1. Only execute recommendation if reunification flag is active
  if (!guardian.reunificationTriggered && !child.reunificationTriggered) {
    return null;
  }

  const preferredThreshold = options?.densityThreshold ?? 1.2;

  // 2. Compute midpoint between the two entities
  const midpointX = (guardian.x + child.x) / 2;
  const midpointY = (guardian.y + child.y) / 2;

  // 3. Try to find the closest safe zone to the midpoint
  let chosenZoneId = '';
  const thresholds = [preferredThreshold, 1.6, 2.0];

  for (const threshold of thresholds) {
    let minDistance = Infinity;
    world.zones.forEach((zone) => {
      if (zone.currentDensity <= threshold) {
        const center = zoneCenters[zone.id];
        if (center) {
          const dist = Math.sqrt(
            (midpointX - center.x) ** 2 + (midpointY - center.y) ** 2
          );
          if (dist < minDistance) {
            minDistance = dist;
            chosenZoneId = zone.id;
          }
        }
      }
    });
    if (chosenZoneId) break;
  }

  // Absolute fallback: pick closest zone regardless of density if all are overloaded
  if (!chosenZoneId) {
    let minDistance = Infinity;
    world.zones.forEach((zone) => {
      const center = zoneCenters[zone.id];
      if (center) {
        const dist = Math.sqrt(
          (midpointX - center.x) ** 2 + (midpointY - center.y) ** 2
        );
        if (dist < minDistance) {
          minDistance = dist;
          chosenZoneId = zone.id;
        }
      }
    });
  }

  if (!chosenZoneId) {
    // If somehow no zone is found, fallback to South Concourse center
    chosenZoneId = 'zone-south-concourse';
  }

  const targetCenter = zoneCenters[chosenZoneId];
  const chosenZone = world.zones.get(chosenZoneId);
  const chosenDensity = chosenZone ? chosenZone.currentDensity : 0;

  let degradationLevel: 'preferred' | 'relaxed' | 'unconstrained' = 'preferred';
  if (chosenDensity > 2.0) {
    degradationLevel = 'unconstrained';
  } else if (chosenDensity > preferredThreshold) {
    degradationLevel = 'relaxed';
  }

  return {
    meetingZoneId: chosenZoneId,
    guardianGoal: { x: targetCenter.x, y: targetCenter.y },
    childGoal: { x: targetCenter.x, y: targetCenter.y },
    degradationLevel,
  };
}
