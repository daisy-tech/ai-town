import {
  bgtiles,
  mapheight,
  mapwidth,
  objmap,
  petTownPointsOfInterest,
} from './petTownGraybox';

type Point = { x: number; y: number };

function isBlocked(point: Point): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= mapwidth || point.y >= mapheight) {
    return true;
  }
  return objmap.some((layer) => layer[point.x][point.y] !== -1);
}

function reachableFrom(start: Point): Set<string> {
  const key = (point: Point) => `${point.x},${point.y}`;
  const visited = new Set<string>([key(start)]);
  const queue = [start];

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = key(next);
      if (!visited.has(nextKey) && !isBlocked(next)) {
        visited.add(nextKey);
        queue.push(next);
      }
    }
  }

  return visited;
}

describe('AI-PetTown graybox map', () => {
  test('uses the approved 80x60 dimensions on every layer', () => {
    expect(mapwidth).toBe(80);
    expect(mapheight).toBe(60);

    for (const layer of [...bgtiles, ...objmap]) {
      expect(layer).toHaveLength(mapwidth);
      for (const column of layer) {
        expect(column).toHaveLength(mapheight);
      }
    }
  });

  test('keeps every point of interest in bounds and walkable', () => {
    for (const [name, point] of Object.entries(petTownPointsOfInterest)) {
      expect({ name, point }).toEqual({
        name,
        point: expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      });
      expect(isBlocked(point)).toBe(false);
    }
  });

  test('connects every point of interest to the child spawn', () => {
    const reachable = reachableFrom(petTownPointsOfInterest.childSpawn);
    for (const [name, point] of Object.entries(petTownPointsOfInterest)) {
      expect(reachable.has(`${point.x},${point.y}`)).toBe(true);
      if (!reachable.has(`${point.x},${point.y}`)) {
        throw new Error(`${name} at (${point.x}, ${point.y}) is unreachable`);
      }
    }
  });
});
