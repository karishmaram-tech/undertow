import type { ParticleState, ParticleType } from './types';

export class Particle {
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
  baseSpeed?: number;
  collisionCount: number = 0;

  // Force accumulators
  fx: number = 0;
  fy: number = 0;

  // Relaxation time for goal-seeking force
  private tau: number = 0.3; // seconds

  constructor(
    id: string,
    x: number,
    y: number,
    type: ParticleType,
    goalX: number,
    goalY: number,
    randomFn: () => number = Math.random
  ) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.type = type;
    this.goalX = goalX;
    this.goalY = goalY;
    this.isActive = true;

    const rand = randomFn;

    // Set physical properties based on type (1 meter = 20 pixels scale)
    switch (type) {
      case 'mobility-impaired':
        this.radius = 12; // 0.6m radius
        this.mass = 1.5;
        // Slower movement speed: 0.6 to 0.8 m/s (12 to 16 px/s)
        this.desiredSpeed = 12 + rand() * 4;
        break;
      case 'sensory-sensitive':
        this.radius = 8; // 0.4m radius
        this.mass = 1.0;
        // Speeds: 1.0 to 1.2 m/s (20 to 24 px/s)
        this.desiredSpeed = 20 + rand() * 4;
        break;
      case 'elderly':
        this.radius = 8;
        this.mass = 1.0;
        // Speeds: 0.7 to 0.9 m/s (14 to 18 px/s)
        this.desiredSpeed = 14 + rand() * 4;
        break;
      case 'unaccompanied-minor':
        this.radius = 6; // 0.3m radius
        this.mass = 0.7;
        // Speeds: 1.1 to 1.3 m/s (22 to 26 px/s)
        this.desiredSpeed = 22 + rand() * 4;
        break;
      case 'guardian':
        this.radius = 8;
        this.mass = 1.2;
        // Speeds: 1.2 to 1.4 m/s (24 to 28 px/s)
        this.desiredSpeed = 24 + rand() * 4;
        break;
      case 'general':
      default:
        this.radius = 8; // 0.4m radius
        this.mass = 1.0;
        // Standard speeds: 1.2 to 1.5 m/s (24 to 30 px/s)
        this.desiredSpeed = 24 + rand() * 6;
        break;
    }
  }

  resetForces() {
    this.fx = 0;
    this.fy = 0;
    this.collisionCount = 0;
  }

  applyForce(fx: number, fy: number) {
    this.fx += fx;
    this.fy += fy;
  }

  addGoalSeekingForce() {
    if (!this.isActive) return;

    const dx = this.goalX - this.x;
    const dy = this.goalY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      // Arrived near destination
      this.vx *= 0.5;
      this.vy *= 0.5;
      return;
    }

    // Direction vector
    const ex = dx / dist;
    const ey = dy / dist;

    // Desired velocity vector
    const vdx = ex * this.desiredSpeed;
    const vdy = ey * this.desiredSpeed;

    // Goal-seeking force: F = m * (V_desired - V_current) / tau
    const fGoalX = (this.mass * (vdx - this.vx)) / this.tau;
    const fGoalY = (this.mass * (vdy - this.vy)) / this.tau;

    this.applyForce(fGoalX, fGoalY);
  }

  updateVelocity(dt: number) {
    if (!this.isActive) return;

    // Acceleration: a = F / m
    const ax = this.fx / this.mass;
    const ay = this.fy / this.mass;

    this.vx += ax * dt;
    this.vy += ay * dt;

    // Speed clamping (prevent extreme acceleration/explosion under high pressure)
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const maxSpeed = this.desiredSpeed * 2.0;
    if (speed > maxSpeed && speed > 0) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }
  }

  updatePosition(dt: number) {
    if (!this.isActive) return;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  getState(): ParticleState {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      radius: this.radius,
      mass: this.mass,
      type: this.type,
      goalX: this.goalX,
      goalY: this.goalY,
      desiredSpeed: this.desiredSpeed,
      isActive: this.isActive,
      isSpecial: this.isSpecial,
      name: this.name,
      distress: this.distress,
      stress: this.stress,
      reunificationTriggered: this.reunificationTriggered,
      escaped: this.escaped,
      currentZoneId: this.currentZoneId,
    };
  }
}
