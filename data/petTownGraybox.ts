// AI-PetTown MVP graybox map.
// Coordinates follow the approved 80x60 blueprint (origin at top-left).

export const tilesetpath = '/ai-town/assets/pet-town-graybox.png';
export const tiledim = 32;
export const screenxtiles = 80;
export const screenytiles = 60;
export const tilesetpxw = 256;
export const tilesetpxh = 96;

const GRASS = 0;
const PATH = 1;
const WOOD_FLOOR = 2;
const SCHOOL_FLOOR = 3;
const GARDEN = 4;
const WATER = 5;
const BRIDGE = 6;
const PLAZA_STONE = 7;
const TREE = 8;
const HOME_WALL = 9;
const SCHOOL_WALL = 10;
const LIBRARY_WALL = 11;
const SHOP_WALL = 12;
const FENCE = 13;
const FURNITURE = 14;
const ROCKS = 15;
const COLLISION_ONLY = 16;

type TileLayer = number[][];

function createLayer(fill: number): TileLayer {
  return Array.from({ length: screenxtiles }, () => Array(screenytiles).fill(fill));
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < screenxtiles && y < screenytiles;
}

function setTile(layer: TileLayer, x: number, y: number, tile: number) {
  if (inBounds(x, y)) {
    layer[x][y] = tile;
  }
}

function fillRect(
  layer: TileLayer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tile: number,
) {
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      setTile(layer, x, y, tile);
    }
  }
}

function fillCircle(layer: TileLayer, cx: number, cy: number, radius: number, tile: number) {
  for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        setTile(layer, x, y, tile);
      }
    }
  }
}

function drawRing(
  layer: TileLayer,
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  tile: number,
) {
  for (let x = Math.floor(cx - outerRadius); x <= Math.ceil(cx + outerRadius); x++) {
    for (let y = Math.floor(cy - outerRadius); y <= Math.ceil(cy + outerRadius); y++) {
      const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2;
      if (distanceSquared >= innerRadius ** 2 && distanceSquared <= outerRadius ** 2) {
        setTile(layer, x, y, tile);
      }
    }
  }
}

function drawThickLine(
  layer: TileLayer,
  start: readonly [number, number],
  end: readonly [number, number],
  radius: number,
  tile: number,
) {
  const [startX, startY] = start;
  const [endX, endY] = end;
  const steps = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
  for (let step = 0; step <= steps; step++) {
    const progress = steps === 0 ? 0 : step / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    fillCircle(layer, x, y, radius, tile);
  }
}

function outlineRect(
  layer: TileLayer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tile: number,
) {
  for (let x = x1; x <= x2; x++) {
    setTile(layer, x, y1, tile);
    setTile(layer, x, y2, tile);
  }
  for (let y = y1; y <= y2; y++) {
    setTile(layer, x1, y, tile);
    setTile(layer, x2, y, tile);
  }
}

function clearTiles(layer: TileLayer, tiles: ReadonlyArray<readonly [number, number]>) {
  for (const [x, y] of tiles) {
    setTile(layer, x, y, -1);
  }
}

const ground = createLayer(GRASS);
const details = createLayer(-1);
const collision = createLayer(-1);

// Main radial routes.
const routes: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]> = [
  [[40, 30], [44, 19]],
  [[40, 30], [16, 19]],
  [[40, 30], [17, 39]],
  [[40, 30], [56, 31]],
  [[40, 30], [41, 44]],
  [[41, 48], [66, 48]],
  [[56, 31], [69, 40]],
  // Outer community loop.
  [[16, 19], [30, 16]],
  [[30, 16], [44, 19]],
  [[44, 19], [56, 31]],
  [[56, 31], [66, 48]],
  [[66, 48], [41, 52]],
  [[41, 52], [17, 54]],
  [[17, 54], [8, 31]],
  [[8, 31], [16, 19]],
];

for (const [start, end] of routes) {
  drawThickLine(details, start, end, 2, PATH);
}
drawRing(details, 40, 30, 9, 11, PATH);

// Region floors.
fillRect(details, 6, 6, 24, 18, WOOD_FLOOR); // Shared home.
fillRect(details, 31, 4, 59, 13, SCHOOL_FLOOR); // School building.
fillRect(details, 34, 15, 56, 20, GARDEN); // Playground and field.
fillRect(details, 4, 23, 22, 33, GARDEN); // Orchard and community garden.
fillRect(details, 6, 40, 26, 53, SCHOOL_FLOOR); // Library and interest hall.
fillRect(details, 57, 23, 70, 35, WOOD_FLOOR); // Town life street.
fillCircle(details, 40, 30, 8, PLAZA_STONE); // Wish tree plaza.

// River wrapping the east and south boundaries.
for (let y = 0; y < screenytiles; y++) {
  const riverStart = 73 + Math.round(Math.sin(y / 5) * 1.5);
  for (let x = riverStart; x < screenxtiles; x++) {
    setTile(details, x, y, WATER);
    setTile(collision, x, y, WATER);
  }
}
for (let x = 48; x < screenxtiles; x++) {
  const riverStart = 56 + Math.round(Math.sin(x / 6));
  for (let y = riverStart; y < screenytiles; y++) {
    setTile(details, x, y, WATER);
    setTile(collision, x, y, WATER);
  }
}

// A visual bridge and fishing platform on the accessible bank.
fillRect(details, 70, 39, 75, 41, BRIDGE);
fillRect(collision, 70, 39, 75, 41, -1);
fillRect(details, 67, 52, 71, 54, BRIDGE);
fillRect(collision, 67, 52, 71, 54, -1);

// Natural map boundary. Water already seals the east and south sides.
for (let x = 0; x < screenxtiles; x++) {
  setTile(collision, x, 0, TREE);
  setTile(collision, x, 1, TREE);
}
for (let y = 0; y < screenytiles; y++) {
  setTile(collision, 0, y, TREE);
  setTile(collision, 1, y, TREE);
}

// Open-cutaway building walls.
outlineRect(collision, 5, 5, 25, 19, HOME_WALL);
clearTiles(collision, [
  [15, 19],
  [16, 19],
]);

outlineRect(collision, 30, 3, 60, 14, SCHOOL_WALL);
clearTiles(collision, [
  [43, 14],
  [44, 14],
  [45, 14],
]);

outlineRect(collision, 5, 39, 27, 54, LIBRARY_WALL);
clearTiles(collision, [
  [16, 39],
  [17, 39],
  [18, 39],
]);

outlineRect(collision, 56, 22, 71, 36, SHOP_WALL);
clearTiles(collision, [
  [56, 30],
  [56, 31],
  [56, 32],
]);

// Orchard fence with two generous entrances.
outlineRect(collision, 3, 22, 23, 34, FENCE);
clearTiles(collision, [
  [23, 27],
  [23, 28],
  [23, 29],
  [8, 34],
  [9, 34],
  [10, 34],
]);

// Furniture and trees leave at least two-tile aisles around all activity points.
// Every blocker is invisible (COLLISION_ONLY); the visible art comes from the
// staticsprites list below.
const blockers: ReadonlyArray<readonly [number, number, number]> = [
  // Shared home furniture.
  [8, 8, COLLISION_ONLY],
  [11, 8, COLLISION_ONLY],
  [14, 8, COLLISION_ONLY],
  [17, 8, COLLISION_ONLY],
  [20, 8, COLLISION_ONLY],
  [22, 14, COLLISION_ONLY],
  [8, 15, COLLISION_ONLY],
  [24, 6, COLLISION_ONLY],
  // School: desks, chalkboards, teacher desk and playground equipment.
  [34, 7, COLLISION_ONLY],
  [38, 7, COLLISION_ONLY],
  [34, 11, COLLISION_ONLY],
  [38, 11, COLLISION_ONLY],
  [48, 7, COLLISION_ONLY],
  [52, 7, COLLISION_ONLY],
  [48, 11, COLLISION_ONLY],
  [52, 11, COLLISION_ONLY],
  [36, 4, COLLISION_ONLY],
  [37, 4, COLLISION_ONLY],
  [50, 4, COLLISION_ONLY],
  [51, 4, COLLISION_ONLY],
  [43, 4, COLLISION_ONLY],
  [44, 4, COLLISION_ONLY],
  [45, 16, COLLISION_ONLY],
  [46, 16, COLLISION_ONLY],
  [49, 16, COLLISION_ONLY],
  [50, 16, COLLISION_ONLY],
  [53, 17, COLLISION_ONLY],
  [54, 17, COLLISION_ONLY],
  // Library / interest hall.
  [8, 42, COLLISION_ONLY],
  [12, 42, COLLISION_ONLY],
  [22, 42, COLLISION_ONLY],
  [8, 49, COLLISION_ONLY],
  [23, 50, COLLISION_ONLY],
  [15, 45, COLLISION_ONLY],
  [16, 45, COLLISION_ONLY],
  [18, 45, COLLISION_ONLY],
  [19, 42, COLLISION_ONLY],
  // Shop street.
  [59, 25, COLLISION_ONLY],
  [64, 25, COLLISION_ONLY],
  [68, 25, COLLISION_ONLY],
  [68, 32, COLLISION_ONLY],
  [57, 32, COLLISION_ONLY],
  [70, 34, COLLISION_ONLY],
  // Wish tree trunk.
  [40, 30, COLLISION_ONLY],
  [41, 30, COLLISION_ONLY],
  [40, 31, COLLISION_ONLY],
  [41, 31, COLLISION_ONLY],
  // Orchard: trees, beds, plots and tools.
  [7, 25, COLLISION_ONLY],
  [12, 25, COLLISION_ONLY],
  [17, 25, COLLISION_ONLY],
  [8, 30, COLLISION_ONLY],
  [14, 30, COLLISION_ONLY],
  [19, 30, COLLISION_ONLY],
  [5, 23, COLLISION_ONLY],
  [6, 23, COLLISION_ONLY],
  [10, 23, COLLISION_ONLY],
  [11, 23, COLLISION_ONLY],
  [15, 23, COLLISION_ONLY],
  [16, 23, COLLISION_ONLY],
  [20, 28, COLLISION_ONLY],
  [5, 32, COLLISION_ONLY],
  // Riverside and meadow.
  [65, 47, COLLISION_ONLY],
  [44, 46, COLLISION_ONLY],
  [30, 45, COLLISION_ONLY],
  [50, 42, COLLISION_ONLY],
  // Wish-tree plaza furniture. The visible art is supplied by staticsprites.
  [30, 29, COLLISION_ONLY],
  [31, 29, COLLISION_ONLY],
  [36, 33, COLLISION_ONLY],
  [37, 33, COLLISION_ONLY],
  [38, 33, COLLISION_ONLY],
  [49, 30, COLLISION_ONLY],
  [50, 30, COLLISION_ONLY],
  [51, 30, COLLISION_ONLY],
  [49, 31, COLLISION_ONLY],
  [50, 31, COLLISION_ONLY],
  [51, 31, COLLISION_ONLY],
  [38, 38, COLLISION_ONLY],
  [39, 38, COLLISION_ONLY],
  [40, 38, COLLISION_ONLY],
  [35, 36, COLLISION_ONLY],
  [44, 36, COLLISION_ONLY],
];

for (const [x, y, tile] of blockers) {
  setTile(collision, x, y, tile);
}

// A few rocks define the riverbank without creating narrow walkable traps.
// The rock art is placed via staticsprites; these are just the footprints.
for (const [x, y] of [
  [70, 8],
  [71, 18],
  [69, 27],
  [70, 46],
  [58, 54],
] as const) {
  setTile(collision, x, y, COLLISION_ONLY);
}

export const bgtiles = [ground, details];
export const objmap = [collision];
export const animatedsprites: Array<{
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  sheet: string;
  animation: string;
}> = [];

type StaticSpriteData = {
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  sortY?: number;
};

// Props cut from the approved asset boards. Coordinates/sizes are in tiles;
// sortY is the ground-contact row used for depth sorting against characters.
// Props without sortY render beneath characters (rugs, docks, flowers).
function prop(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sortYTiles?: number,
): StaticSpriteData {
  return {
    x: x * tiledim,
    y: y * tiledim,
    w: w * tiledim,
    h: h * tiledim,
    url: `/ai-town/assets/pet-town/props/${name}.png`,
    ...(sortYTiles === undefined ? {} : { sortY: sortYTiles * tiledim }),
  };
}

export const staticsprites: StaticSpriteData[] = [
  {
    x: 31 * tiledim,
    y: 21 * tiledim,
    w: 18 * tiledim,
    h: 18 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/plaza-ground.png',
  },
  {
    x: 35.5 * tiledim,
    y: 20 * tiledim,
    w: 9 * tiledim,
    h: 10.625 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/wish-tree.png',
    sortY: 31 * tiledim,
  },
  {
    x: 29.5 * tiledim,
    y: 26.5 * tiledim,
    w: 3 * tiledim,
    h: 3 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/notice-board.png',
    sortY: 30 * tiledim,
  },
  {
    x: 48 * tiledim,
    y: 27.5 * tiledim,
    w: 4.5 * tiledim,
    h: 3.5 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/small-stage.png',
    sortY: 31.5 * tiledim,
  },
  {
    x: 37.5 * tiledim,
    y: 35.5 * tiledim,
    w: 4 * tiledim,
    h: 3 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/memory-leaf-rack.png',
    sortY: 38.5 * tiledim,
  },
  {
    x: 35.5 * tiledim,
    y: 32 * tiledim,
    w: 4 * tiledim,
    h: 1.6 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/curved-bench.png',
    sortY: 33.6 * tiledim,
  },
  {
    x: 34.25 * tiledim,
    y: 33.5 * tiledim,
    w: 1.5 * tiledim,
    h: 2.5 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/plaza-lantern.png',
    sortY: 36 * tiledim,
  },
  {
    x: 43.75 * tiledim,
    y: 33.5 * tiledim,
    w: 1.5 * tiledim,
    h: 2.5 * tiledim,
    url: '/ai-town/assets/pet-town/plaza/plaza-lantern.png',
    sortY: 36 * tiledim,
  },

  // Shared home (blockers at rows 8/14/15 plus the corner plant).
  prop('rug', 9, 11.5, 3, 1.8),
  prop('bed-red', 7.4, 6.3, 1.6, 2.2, 9),
  prop('bed-blue', 10.4, 6.3, 1.6, 2.2, 9),
  prop('sofa', 13.3, 7.2, 2.4, 1.8, 9),
  prop('home-shelf', 16.5, 7.0, 2.0, 2.0, 9),
  prop('flower-table', 19.8, 6.9, 1.4, 2.1, 9),
  prop('potted-plant', 23.7, 5.4, 1.3, 1.6, 7),
  prop('dining-table', 21.2, 13.2, 2.6, 2.0, 15),
  prop('floor-lamp', 7.7, 14.0, 0.9, 2.1, 16),

  // School classrooms and playground.
  prop('chalkboard', 35.6, 3.2, 2.4, 2.1, 5),
  prop('chalkboard', 49.6, 3.2, 2.4, 2.1, 5),
  prop('teacher-desk', 42.7, 3.4, 2.4, 2.1, 5),
  prop('school-desk', 33.5, 6.1, 2.0, 1.5, 8),
  prop('school-desk', 37.5, 6.1, 2.0, 1.5, 8),
  prop('school-desk', 33.5, 10.1, 2.0, 1.5, 12),
  prop('school-desk', 37.5, 10.1, 2.0, 1.5, 12),
  prop('school-desk', 47.5, 6.1, 2.0, 1.5, 8),
  prop('school-desk', 51.5, 6.1, 2.0, 1.5, 8),
  prop('school-desk', 47.5, 10.1, 2.0, 1.5, 12),
  prop('school-desk', 51.5, 10.1, 2.0, 1.5, 12),
  prop('slide', 44.6, 14.7, 2.2, 2.4, 17),
  prop('swing', 48.5, 14.8, 2.8, 2.4, 17),
  prop('sandbox', 52.6, 16.2, 2.6, 1.9, 18),

  // Orchard and community garden.
  prop('apple-tree', 6.2, 23.2, 2.6, 2.8, 26),
  prop('apple-tree-ladder', 11.2, 23.2, 2.4, 2.9, 26),
  prop('apple-tree', 16.2, 23.2, 2.6, 2.8, 26),
  prop('apple-tree', 13.2, 28.2, 2.6, 2.8, 31),
  prop('apple-tree-ladder', 18.2, 28.2, 2.4, 2.9, 31),
  prop('picnic-table', 7.0, 29.1, 3.0, 2.0, 31),
  prop('flowerbed-tulip', 4.5, 22.6, 3.0, 1.8, 24),
  prop('plot-cabbage', 9.6, 22.7, 2.8, 1.9, 24),
  prop('plot-carrot', 14.6, 22.7, 2.8, 1.9, 24),
  prop('scarecrow', 19.5, 26.8, 1.6, 2.2, 29),
  prop('wheelbarrow', 4.5, 31.2, 2.0, 1.6, 33),

  // Library and interest hall.
  prop('bookshelf-a', 7.4, 40.4, 1.8, 2.5, 43),
  prop('bookshelf-b', 11.4, 40.3, 1.8, 2.6, 43),
  prop('easel', 18.6, 40.7, 1.5, 2.3, 43),
  prop('craft-table', 21.2, 41.2, 2.4, 1.8, 43),
  prop('reading-table', 14.7, 44.1, 2.2, 1.9, 46),
  prop('armchair', 17.6, 44.1, 1.7, 1.9, 46),
  prop('piano', 7.3, 47.9, 2.2, 2.2, 50),
  prop('drawing-board', 22.3, 48.9, 2.2, 2.2, 51),

  // Town shop street.
  prop('shop-counter', 58.2, 23.9, 2.4, 2.2, 26),
  prop('shop-shelf', 63.3, 23.5, 2.2, 2.6, 26),
  prop('crates', 67.3, 23.9, 2.2, 2.1, 26),
  prop('street-lamp', 67.7, 30.6, 0.9, 2.4, 33),
  prop('post-box', 56.8, 30.9, 1.1, 2.2, 33),
  prop('bus-stop', 69.3, 32.7, 2.2, 2.4, 35),

  // Riverside, dock and quiet meadow.
  prop('dock', 67.4, 51.5, 3.4, 3.3),
  prop('bench', 64.4, 46.2, 2.0, 1.6, 48),
  prop('stump', 43.5, 44.9, 1.7, 1.4, 47),
  prop('bush', 29.3, 43.9, 2.3, 2.1, 46),
  prop('flower-bush', 49.4, 41.1, 1.8, 1.6, 43),
  prop('wildflowers', 39.5, 46.8, 2.2, 1.8),
  prop('wildflowers', 43.0, 49.2, 2.2, 1.8),
  prop('rocks', 69.3, 6.9, 2.2, 1.9, 9),
  prop('boulder', 70.3, 16.9, 1.8, 1.7, 19),
  prop('rocks', 68.3, 25.9, 2.2, 1.9, 28),
  prop('boulder', 69.4, 44.9, 1.9, 1.8, 47),
  prop('rocks', 57.2, 52.9, 2.4, 2.0, 55),
];

export const mapwidth = screenxtiles;
export const mapheight = screenytiles;

export const petTownPointsOfInterest = {
  childSpawn: { x: 39, y: 35 },
  companionSpawn: { x: 41, y: 35 },
  homeEntry: { x: 16, y: 20 },
  homeTable: { x: 19, y: 11 },
  homeSofa: { x: 10, y: 12 },
  homeStudy: { x: 13, y: 17 },
  schoolGate: { x: 44, y: 20 },
  classA: { x: 37, y: 10 },
  classB: { x: 51, y: 10 },
  playground: { x: 47, y: 17 },
  wishTreeMeeting: { x: 38, y: 30 },
  plazaStage: { x: 46, y: 30 },
  orchard: { x: 13, y: 27 },
  picnic: { x: 8, y: 31 },
  libraryNook: { x: 10, y: 45 },
  artTable: { x: 21, y: 44 },
  musicCorner: { x: 11, y: 51 },
  exhibition: { x: 22, y: 51 },
  shopCounter: { x: 61, y: 28 },
  postBox: { x: 57, y: 34 },
  busStop: { x: 69, y: 34 },
  quietMeadow: { x: 41, y: 48 },
  riverBench: { x: 66, y: 48 },
  fishingDock: { x: 69, y: 53 },
  bridge: { x: 72, y: 40 },
} as const;
