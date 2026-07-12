// Quick BFS validation of the pet town map: every POI must be walkable and
// reachable from the child spawn. Run via:
//   npx esbuild data/petTownGraybox.ts --bundle --format=cjs --outfile=/tmp/petmap.cjs
//   node scripts/validate_pet_town_map.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const map = require('/tmp/petmap.cjs');

const { objmap, screenxtiles, screenytiles, petTownPointsOfInterest } = map;
const collision = objmap[0];

const walkable = (x, y) =>
  x >= 0 && x < screenxtiles && y >= 0 && y < screenytiles && collision[x][y] === -1;

const start = petTownPointsOfInterest.childSpawn;
if (!walkable(start.x, start.y)) {
  console.error('childSpawn is not walkable!');
  process.exit(1);
}

const seen = new Set([`${start.x},${start.y}`]);
const queue = [[start.x, start.y]];
while (queue.length) {
  const [x, y] = queue.shift();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    const key = `${nx},${ny}`;
    if (!seen.has(key) && walkable(nx, ny)) {
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
}

let failures = 0;
for (const [name, poi] of Object.entries(petTownPointsOfInterest)) {
  const okWalkable = walkable(poi.x, poi.y);
  const okReachable = seen.has(`${poi.x},${poi.y}`);
  if (!okWalkable || !okReachable) {
    failures += 1;
    console.error(`FAIL ${name} (${poi.x},${poi.y}) walkable=${okWalkable} reachable=${okReachable}`);
  }
}
console.log(`Reachable tiles: ${seen.size}`);
console.log(failures === 0 ? 'All POIs walkable and reachable.' : `${failures} POI failures.`);
process.exit(failures === 0 ? 0 : 1);
