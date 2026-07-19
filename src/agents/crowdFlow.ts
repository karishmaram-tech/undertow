import { SimulationWorld } from '../simulation/SimulationWorld';
import { getZoneDistressScore } from './panicLanguage';
import { agentLogEvents } from '../simulation/agentIntegration';

export interface CrowdFlowForecast {
  gateId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  etaToOverloadSeconds: number;
  contributingSignals:
    'density-only' | 'distress-only-ignored' | 'density+distress-corroborated';
}

interface DensityDataPoint {
  time: number;
  density: number;
}

// Map each world instance to its history of zone densities
// Maps: SimulationWorld -> Map<ZoneId, DensityDataPoint[]>
const worldHistories = new WeakMap<
  SimulationWorld,
  Map<string, DensityDataPoint[]>
>();

// Map each world instance to its previous gate forecast states to avoid log spamming
const worldForecastStates = new WeakMap<
  SimulationWorld,
  Map<string, { riskLevel: string; contributingSignals: string }>
>();

const gateToZoneMapping: Record<string, string> = {
  'gate-nw': 'zone-north-concourse',
  'gate-ne': 'zone-north-concourse',
  'gate-e': 'zone-east-concourse',
  'gate-se': 'zone-south-concourse',
  'gate-sw': 'zone-south-concourse',
  'gate-w': 'zone-west-concourse',
};

const OVERLOAD_DENSITY_THRESHOLD = 2.0; // particles per square meter
const HISTORY_WINDOW_SECONDS = 5.0;

export function runCrowdFlowAgent(world: SimulationWorld): CrowdFlowForecast[] {
  // 1. Get or create history map for this world instance
  let historyMap = worldHistories.get(world);
  if (!historyMap) {
    historyMap = new Map<string, DensityDataPoint[]>();
    worldHistories.set(world, historyMap);
  }

  const currentTime = world.simulationTime;

  // 2. Read densities directly from world zones (updated by getSnapshot)
  const zoneDensities = new Map<string, number>();

  world.zones.forEach((zone) => {
    const density = zone.currentDensity;
    zoneDensities.set(zone.id, density);

    // Update history for this zone
    let history = historyMap!.get(zone.id);
    if (!history) {
      history = [];
      historyMap!.set(zone.id, history);
    }

    // Detect if simulation time has reset/run backwards, and clear history
    const lastPoint = history[history.length - 1];
    if (lastPoint && currentTime < lastPoint.time) {
      history.length = 0;
    }

    // Push new point if the simulation time has advanced
    if (
      history.length === 0 ||
      history[history.length - 1].time !== currentTime
    ) {
      history.push({ time: currentTime, density });
    }

    // Filter rolling window
    historyMap!.set(
      zone.id,
      history.filter((pt) => currentTime - pt.time <= HISTORY_WINDOW_SECONDS)
    );
  });

  const forecasts: CrowdFlowForecast[] = [];

  // 3. For each gate, perform linear regression and forecast overload
  world.gates.forEach((gate) => {
    const zoneId = gateToZoneMapping[gate.id] || 'zone-south-concourse';
    const currentDensity = zoneDensities.get(zoneId) || 0;
    const history = historyMap!.get(zoneId) || [];

    let slope = 0;

    // Linear regression to find density trend slope (change in density per second)
    if (history.length >= 5) {
      const firstPoint = history[0];
      const lastPoint = history[history.length - 1];
      const timeSpan = lastPoint.time - firstPoint.time;

      if (timeSpan >= 0.5) {
        let sumX = 0;
        let sumY = 0;
        const n = history.length;

        for (let i = 0; i < n; i++) {
          sumX += history[i].time;
          sumY += history[i].density;
        }

        const meanX = sumX / n;
        const meanY = sumY / n;

        // Calculate slope (least squares regression)
        let numerator = 0;
        let denominator = 0;

        for (let i = 0; i < n; i++) {
          const pt = history[i];
          const diffX = pt.time - meanX;
          numerator += diffX * (pt.density - meanY);
          denominator += diffX * diffX;
        }

        if (denominator > 0) {
          slope = numerator / denominator;
        }
      }
    }

    // Forecast time-to-overload and assign risk level
    let etaToOverloadSeconds: number;
    let baseRiskLevel: 'low' | 'medium' | 'high' | 'critical';

    if (currentDensity >= OVERLOAD_DENSITY_THRESHOLD) {
      baseRiskLevel = 'critical';
      etaToOverloadSeconds = 0;
    } else if (slope > 0.005) {
      const densityGap = OVERLOAD_DENSITY_THRESHOLD - currentDensity;
      etaToOverloadSeconds = densityGap / slope;

      if (etaToOverloadSeconds < 5.0) {
        baseRiskLevel = 'critical';
      } else if (etaToOverloadSeconds < 15.0) {
        baseRiskLevel = 'high';
      } else if (etaToOverloadSeconds < 30.0) {
        baseRiskLevel = 'medium';
      } else {
        baseRiskLevel = 'low';
      }
    } else {
      baseRiskLevel = 'low';
      etaToOverloadSeconds = Infinity;
    }

    const distress = getZoneDistressScore(zoneId);
    const distressElevated = distress > 0.5;
    const densityTrendRising = slope > 0.005;

    let riskLevel = baseRiskLevel;
    let contributingSignals:
      | 'density-only'
      | 'distress-only-ignored'
      | 'density+distress-corroborated';

    if (distressElevated) {
      if (densityTrendRising) {
        contributingSignals = 'density+distress-corroborated';
        // Escalate risk level by one tier
        if (baseRiskLevel === 'low') riskLevel = 'medium';
        else if (baseRiskLevel === 'medium') riskLevel = 'high';
        else if (baseRiskLevel === 'high') riskLevel = 'critical';
      } else {
        contributingSignals = 'distress-only-ignored';
      }
    } else {
      contributingSignals = 'density-only';
    }

    // 4. Log state transitions in agentLogEvents to display in Mission Control Log
    let worldStates = worldForecastStates.get(world);
    if (!worldStates) {
      worldStates = new Map();
      worldForecastStates.set(world, worldStates);
    }
    const previous = worldStates.get(gate.id);
    const hasTransitioned = previous
      ? previous.riskLevel !== riskLevel
      : riskLevel !== 'low';

    if (hasTransitioned) {
      worldStates.set(gate.id, { riskLevel, contributingSignals });

      let logDescription: string;
      if (contributingSignals === 'density+distress-corroborated') {
        logDescription = `Gate ${gate.name.toUpperCase()} risk escalated to ${riskLevel.toUpperCase()} (corroborated density trend and elevated distress: ${(distress * 100).toFixed(0)}%).`;
      } else if (contributingSignals === 'distress-only-ignored') {
        logDescription = `Elevated distress (${(distress * 100).toFixed(0)}%) in feeding zone "${zoneId.replace('zone-', '').toUpperCase()}" ignored for Gate ${gate.name.toUpperCase()} due to stable density (false alarm check).`;
      } else {
        logDescription = `Gate ${gate.name.toUpperCase()} crowd risk classified as ${riskLevel.toUpperCase()} based on density-only telemetry.`;
      }

      agentLogEvents.push({
        timestamp: currentTime,
        agentName: 'Crowd-Flow',
        entityId: gate.id,
        entityName: gate.name,
        description: logDescription,
        degraded: riskLevel === 'high' || riskLevel === 'critical',
      });
    } else {
      worldStates.set(gate.id, { riskLevel, contributingSignals });
    }

    forecasts.push({
      gateId: gate.id,
      riskLevel,
      etaToOverloadSeconds,
      contributingSignals,
    });
  });

  return forecasts;
}
