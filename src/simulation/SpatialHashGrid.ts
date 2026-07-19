import { Particle } from './Particle';

export class SpatialHashGrid {
  cells: Particle[][];
  cols: number;
  rows: number;
  cellSize: number;

  constructor(width: number, height: number, cellSize: number = 50) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    const numCells = this.cols * this.rows;
    this.cells = Array.from({ length: numCells }, () => []);
  }

  clear() {
    const len = this.cells.length;
    for (let i = 0; i < len; i++) {
      this.cells[i].length = 0;
    }
  }

  insert(particle: Particle) {
    const cx = Math.floor(particle.x / this.cellSize);
    const cy = Math.floor(particle.y / this.cellSize);
    if (cx >= 0 && cx < this.cols && cy >= 0 && cy < this.rows) {
      const index = cy * this.cols + cx;
      this.cells[index].push(particle);
    }
  }

  getNeighbors(x: number, y: number, queryRadius: number): Particle[] {
    const neighbors: Particle[] = [];
    this.getNeighborsStore(x, y, queryRadius, neighbors);
    return neighbors;
  }

  getNeighborsStore(
    x: number,
    y: number,
    queryRadius: number,
    store: Particle[]
  ) {
    store.length = 0;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cellRange = Math.max(1, Math.ceil(queryRadius / this.cellSize));

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      const ncx = cx + dx;
      if (ncx < 0 || ncx >= this.cols) continue;
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        const ncy = cy + dy;
        if (ncy < 0 || ncy >= this.rows) continue;
        const index = ncy * this.cols + ncx;
        const cell = this.cells[index];
        const len = cell.length;
        for (let i = 0; i < len; i++) {
          store.push(cell[i]);
        }
      }
    }
  }
}
