export type ParticleType =
  | 'general'
  | 'mobility-impaired'
  | 'sensory-sensitive'
  | 'unaccompanied-minor'
  | 'guardian'
  | 'elderly';

export interface ParticleState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  type: ParticleType;
  goalX: number;
  goalY: number;
  desiredSpeed: number;
  isActive: boolean;
  isSpecial?: boolean;
  name?: string;
  distress?: number;
  stress?: number;
  reunificationTriggered?: boolean;
  escaped?: boolean;
  currentZoneId?: string;
}

export interface Gate {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  capacity: number; // particles per second
  lastPassageTime: number; // in simulation seconds
  currentThroughput: number; // actual particles per second (rolling window)
  overloaded: boolean; // manually overloaded state
  passageTimes: number[]; // timestamps of recent passages
}

export interface Zone {
  id: string;
  name: string;
  points: { x: number; y: number }[];
  area: number; // in square meters
  currentDensity: number; // particles per square meter
  particleCount: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SimulationStats {
  activeParticles: number;
  totalEscaped: number;
  fps: number;
  elapsedTime: number;
}

export interface AgentLogEvent {
  timestamp: number;
  agentName:
    | 'Routing'
    | 'Reunification'
    | 'Crowd-Flow'
    | 'Verification'
    | 'Panic-Language';
  entityId: string;
  entityName: string;
  description: string;
  degraded: boolean;
}

export interface SimulationSnapshot {
  particles: ParticleState[];
  gates: {
    id: string;
    name: string;
    throughput: number;
    capacity: number;
    overloaded: boolean;
  }[];
  zones: {
    id: string;
    name: string;
    density: number;
    particleCount: number;
  }[];
  stats: SimulationStats;
  agentLogs?: AgentLogEvent[];
}
