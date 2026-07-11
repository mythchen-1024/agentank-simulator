import { DIRECTIONS } from "./constants.js";
import { blocksMovement, isSamePoint, openMap, pointKey } from "./map.js";

export function createRandomScenario(options = {}) {
  const width = Math.max(7, Math.floor(Number(options.width) || 19));
  const height = Math.max(7, Math.floor(Number(options.height) || 15));
  const count = Math.max(2, Math.floor(Number(options.count) || 2));
  const rng = options.rng || seededRandom(options.seed ?? 1);
  const map = openMap(width, height);
  // The fixed symmetric 1v1 starts only apply to 2-tank scenarios; N>2 picks N spaced starts.
  const fixedStarts = count === 2 && options.fixedStarts !== false ? fixedSymmetricStarts(map) : null;
  fillRandomTerrain(map, rng, fixedStarts ? fixedStarts.map((start) => start.position) : []);
  const starts = fixedStarts || pickStarts(map, rng, count);
  const star = pickOpenCell(map, rng, starts.map((start) => start.position));
  return { map, tanks: starts, star };
}

export function serializeRawMap(map, tanks = []) {
  const rows = [];
  const tankByPosition = new Map();
  tanks.forEach((tank, index) => {
    if (!tank?.position) return;
    tankByPosition.set(pointKey(tank.position), tankChar(index, tank.direction));
  });
  for (let y = 0; y < (map[0]?.length || 0); y += 1) {
    let row = "";
    for (let x = 0; x < map.length; x += 1) {
      row += tankByPosition.get(pointKey([x, y])) || map[x][y] || ".";
    }
    rows.push(row);
  }
  return rows.join("|");
}

export function fillRandomTerrain(map, rng, protectedPositions = []) {
  const width = map.length;
  const height = map[0]?.length || 0;
  const protectedCells = new Set(protectedPositions.map(pointKey));
  for (let x = 1; x < width - 1; x += 1) {
    for (let y = 1; y < height - 1; y += 1) {
      const rx = width - 1 - x;
      const ry = height - 1 - y;
      if (x > rx || (x === rx && y > ry)) continue;

      const protectedPair = protectedCells.has(pointKey([x, y])) ||
        protectedCells.has(pointKey([rx, ry]));
      const terrain = protectedPair ? "." : randomTerrain(rng);
      map[x][y] = terrain;
      map[rx][ry] = terrain;
    }
  }
}

export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fixedSymmetricStarts(map) {
  const width = map.length;
  const height = map[0]?.length || 0;
  const first = [2, 2];
  const second = [width - 3, height - 3];
  if (width < 9 || height < 9) return null;
  if (blocksMovement(map, first[0], first[1]) || blocksMovement(map, second[0], second[1])) return null;
  if (manhattan(first, second) < 6) return null;
  return [
    { position: first, direction: "up" },
    { position: second, direction: "down" }
  ];
}

function randomTerrain(rng) {
  const roll = rng();
  if (roll < 0.08) return "m";
  if (roll < 0.13) return "o";
  return ".";
}

function pickStarts(map, rng, count = 2) {
  const minSpacing = count <= 2 ? 6 : 3;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const starts = [];
    let ok = true;
    for (let i = 0; i < count; i += 1) {
      const position = pickOpenCell(map, rng, starts.map((start) => start.position));
      if (starts.some((start) => manhattan(start.position, position) < minSpacing)) {
        ok = false;
        break;
      }
      starts.push({ position, direction: randomDirection(rng) });
    }
    if (ok && starts.length === count) return starts;
  }
  // Fallback: accept whatever distinct cells we can find without the spacing guarantee.
  const starts = [];
  for (let i = 0; i < count; i += 1) {
    const position = pickOpenCell(map, rng, starts.map((start) => start.position));
    starts.push({ position, direction: randomDirection(rng) });
  }
  return starts;
}

function pickOpenCell(map, rng, excluded = []) {
  const cells = openCells(map).filter((cell) => !excluded.some((position) => isSamePoint(position, cell)));
  return cells[Math.floor(rng() * cells.length)] || [1, 1];
}

function openCells(map) {
  const cells = [];
  for (let x = 1; x < map.length - 1; x += 1) {
    for (let y = 1; y < (map[x]?.length || 0) - 1; y += 1) {
      if (!blocksMovement(map, x, y)) cells.push([x, y]);
    }
  }
  return cells;
}

function randomDirection(rng) {
  return DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)] || "up";
}

function tankChar(index, direction) {
  if (index >= 2) return String(index); // players 2-9 serialize as a single digit (position only)
  const chars = index === 0 ? "abcd" : "ABCD";
  const directionIndex = DIRECTIONS.indexOf(direction);
  return chars[directionIndex >= 0 ? directionIndex : 0];
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
