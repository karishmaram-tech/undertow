import { SimulationWorld } from './SimulationWorld';
import { stadiumLayout } from '../data/stadiumLayout';

const world = new SimulationWorld(1200, 800);
stadiumLayout.gates.forEach((g) => world.addGate(g));
stadiumLayout.zones.forEach((z) => world.addZone(z));
stadiumLayout.walls.forEach((w) => world.addWall(w));

console.log('Zone Areas:');
world.zones.forEach((zone) => {
  console.log(`  ${zone.id} (${zone.name}): Area = ${zone.area.toFixed(2)} m²`);
});
