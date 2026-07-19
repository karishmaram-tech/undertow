export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutGate {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  capacity: number;
}

export interface LayoutZone {
  id: string;
  name: string;
  points: LayoutPoint[];
  ambientNoise: number;
}

export interface LayoutWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StadiumLayout {
  width: number;
  height: number;
  zones: LayoutZone[];
  gates: LayoutGate[];
  walls: LayoutWall[];
}

// Center of stadium is at (600, 400)
// Outer ellipse: Rx = 550, Ry = 350
// Inner boundary ellipse: Rx = 400, Ry = 240
// Innermost field ellipse: Rx = 200, Ry = 100

// Helper to generate ellipse points for wedge polygons
function getEllipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number
): LayoutPoint {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(cx + rx * Math.cos(rad)),
    y: Math.round(cy + ry * Math.sin(rad)),
  };
}

const cx = 600;
const cy = 400;
const rxOuter = 540;
const ryOuter = 340;
const rxInner = 380;
const ryInner = 230;
const rxField = 180;
const ryField = 90;

// Angles separating the 4 quadrants (North, East, South, West)
// North: 225 to 315 deg
// East: 315 to 45 (315 to 405) deg
// South: 45 to 135 deg
// West: 135 to 225 deg

export const stadiumLayout: StadiumLayout = {
  width: 1200,
  height: 800,
  zones: [
    // 1. NORTH SEATS (225 to 315 deg, between Field and Inner Ellipse)
    {
      id: 'zone-north-seats',
      name: 'North Seating Deck',
      points: [
        getEllipsePoint(cx, cy, rxField, ryField, 225),
        getEllipsePoint(cx, cy, rxInner, ryInner, 225),
        getEllipsePoint(cx, cy, rxInner, ryInner, 247),
        getEllipsePoint(cx, cy, rxInner, ryInner, 270),
        getEllipsePoint(cx, cy, rxInner, ryInner, 292),
        getEllipsePoint(cx, cy, rxInner, ryInner, 315),
        getEllipsePoint(cx, cy, rxField, ryField, 315),
        getEllipsePoint(cx, cy, rxField, ryField, 270),
      ],
      ambientNoise: 0.85,
    },
    // 2. NORTH CONCOURSE (225 to 315 deg, between Inner and Outer Ellipse)
    {
      id: 'zone-north-concourse',
      name: 'North Concourse',
      points: [
        getEllipsePoint(cx, cy, rxInner, ryInner, 225),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 225),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 247),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 270),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 292),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 315),
        getEllipsePoint(cx, cy, rxInner, ryInner, 315),
        getEllipsePoint(cx, cy, rxInner, ryInner, 270),
      ],
      ambientNoise: 0.45,
    },
    // 3. EAST SEATS (315 to 405 deg, between Field and Inner Ellipse)
    {
      id: 'zone-east-seats',
      name: 'East Seating Deck',
      points: [
        getEllipsePoint(cx, cy, rxField, ryField, 315),
        getEllipsePoint(cx, cy, rxInner, ryInner, 315),
        getEllipsePoint(cx, cy, rxInner, ryInner, 337),
        getEllipsePoint(cx, cy, rxInner, ryInner, 360),
        getEllipsePoint(cx, cy, rxInner, ryInner, 382),
        getEllipsePoint(cx, cy, rxInner, ryInner, 405),
        getEllipsePoint(cx, cy, rxField, ryField, 405),
        getEllipsePoint(cx, cy, rxField, ryField, 360),
      ],
      ambientNoise: 0.8,
    },
    // 4. EAST CONCOURSE (315 to 405 deg, between Inner and Outer Ellipse)
    {
      id: 'zone-east-concourse',
      name: 'East Concourse',
      points: [
        getEllipsePoint(cx, cy, rxInner, ryInner, 315),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 315),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 337),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 360),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 382),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 405),
        getEllipsePoint(cx, cy, rxInner, ryInner, 405),
        getEllipsePoint(cx, cy, rxInner, ryInner, 360),
      ],
      ambientNoise: 0.5,
    },
    // 5. SOUTH SEATS (45 to 135 deg, between Field and Inner Ellipse)
    {
      id: 'zone-south-seats',
      name: 'South Seating Deck',
      points: [
        getEllipsePoint(cx, cy, rxField, ryField, 45),
        getEllipsePoint(cx, cy, rxInner, ryInner, 45),
        getEllipsePoint(cx, cy, rxInner, ryInner, 67),
        getEllipsePoint(cx, cy, rxInner, ryInner, 90),
        getEllipsePoint(cx, cy, rxInner, ryInner, 112),
        getEllipsePoint(cx, cy, rxInner, ryInner, 135),
        getEllipsePoint(cx, cy, rxField, ryField, 135),
        getEllipsePoint(cx, cy, rxField, ryField, 90),
      ],
      ambientNoise: 0.8,
    },
    // 6. SOUTH CONCOURSE (45 to 135 deg, between Inner and Outer Ellipse)
    {
      id: 'zone-south-concourse',
      name: 'South Concourse',
      points: [
        getEllipsePoint(cx, cy, rxInner, ryInner, 45),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 45),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 67),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 90),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 112),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 135),
        getEllipsePoint(cx, cy, rxInner, ryInner, 135),
        getEllipsePoint(cx, cy, rxInner, ryInner, 90),
      ],
      ambientNoise: 0.4,
    },
    // 7. WEST SEATS (135 to 225 deg, between Field and Inner Ellipse)
    {
      id: 'zone-west-seats',
      name: 'West Seating Deck',
      points: [
        getEllipsePoint(cx, cy, rxField, ryField, 135),
        getEllipsePoint(cx, cy, rxInner, ryInner, 135),
        getEllipsePoint(cx, cy, rxInner, ryInner, 157),
        getEllipsePoint(cx, cy, rxInner, ryInner, 180),
        getEllipsePoint(cx, cy, rxInner, ryInner, 202),
        getEllipsePoint(cx, cy, rxInner, ryInner, 225),
        getEllipsePoint(cx, cy, rxField, ryField, 225),
        getEllipsePoint(cx, cy, rxField, ryField, 180),
      ],
      ambientNoise: 0.9,
    },
    // 8. WEST CONCOURSE (135 to 225 deg, between Inner and Outer Ellipse)
    {
      id: 'zone-west-concourse',
      name: 'West Concourse',
      points: [
        getEllipsePoint(cx, cy, rxInner, ryInner, 135),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 135),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 157),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 180),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 202),
        getEllipsePoint(cx, cy, rxOuter, ryOuter, 225),
        getEllipsePoint(cx, cy, rxInner, ryInner, 225),
        getEllipsePoint(cx, cy, rxInner, ryInner, 180),
      ],
      ambientNoise: 0.45,
    },
  ],
  gates: [
    // 6 outer perimeter gates
    {
      id: 'gate-nw',
      name: 'Gate NW (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 235).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 235).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 245).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 245).y,
      capacity: 15,
    },
    {
      id: 'gate-ne',
      name: 'Gate NE (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 295).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 295).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 305).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 305).y,
      capacity: 15,
    },
    {
      id: 'gate-e',
      name: 'Gate E (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 355).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 355).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 5).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 5).y,
      capacity: 15,
    },
    {
      id: 'gate-se',
      name: 'Gate SE (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 55).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 55).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 65).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 65).y,
      capacity: 15,
    },
    {
      id: 'gate-sw',
      name: 'Gate SW (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 115).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 115).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 125).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 125).y,
      capacity: 15,
    },
    {
      id: 'gate-w',
      name: 'Gate W (Exit)',
      x1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 175).x,
      y1: getEllipsePoint(cx, cy, rxOuter, ryOuter, 175).y,
      x2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 185).x,
      y2: getEllipsePoint(cx, cy, rxOuter, ryOuter, 185).y,
      capacity: 15,
    },
  ],
  walls: [
    // Outer perimeter walls (ellipse segments between gates)
    // We add approximate line segments to draw the outer stadium envelope
    // Let's create segment arrays
  ],
};

// Generate approximate oval wall segments around the perimeter, skipping gates
function generateLayoutWalls() {
  const outerAngles = [
    { start: 5, end: 55 },
    { start: 65, end: 115 },
    { start: 125, end: 175 },
    { start: 185, end: 235 },
    { start: 245, end: 295 },
    { start: 305, end: 355 },
  ];

  for (const range of outerAngles) {
    const steps = 10;
    const stepDeg = (range.end - range.start) / steps;
    for (let i = 0; i < steps; i++) {
      const a1 = range.start + i * stepDeg;
      const a2 = a1 + stepDeg;
      const p1 = getEllipsePoint(cx, cy, rxOuter, ryOuter, a1);
      const p2 = getEllipsePoint(cx, cy, rxOuter, ryOuter, a2);
      stadiumLayout.walls.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
  }

  // Inner partition walls (separating seats from concourse), leaving 4 chokepoint gaps of 30px
  // Gaps are located at angles: 0, 90, 180, 270 deg (North, East, South, West exits from seating)
  const innerAngles = [
    { start: 8, end: 82 },
    { start: 98, end: 172 },
    { start: 188, end: 262 },
    { start: 278, end: 352 },
  ];

  for (const range of innerAngles) {
    const steps = 8;
    const stepDeg = (range.end - range.start) / steps;
    for (let i = 0; i < steps; i++) {
      const a1 = range.start + i * stepDeg;
      const a2 = a1 + stepDeg;
      const p1 = getEllipsePoint(cx, cy, rxInner, ryInner, a1);
      const p2 = getEllipsePoint(cx, cy, rxInner, ryInner, a2);
      stadiumLayout.walls.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
  }

  // Field perimeter walls (separating field from seating deck), leaving 4 stairways of 20px
  // Stairway gaps at 45, 135, 225, 315 deg
  const fieldAngles = [
    { start: 50, end: 130 },
    { start: 140, end: 220 },
    { start: 230, end: 310 },
    { start: 320, end: 40 },
  ];

  for (const range of fieldAngles) {
    const steps = 6;
    const stepDeg = (range.end - range.start) / steps;
    for (let i = 0; i < steps; i++) {
      const a1 = range.start + i * stepDeg;
      const a2 = a1 + stepDeg;
      const p1 = getEllipsePoint(cx, cy, rxField, ryField, a1);
      const p2 = getEllipsePoint(cx, cy, rxField, ryField, a2);
      stadiumLayout.walls.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
  }
}

generateLayoutWalls();
