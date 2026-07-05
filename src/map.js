const PLAYER_ONE = "abcd";
const PLAYER_TWO = "ABCD";
const DIRECTIONS_BY_CHAR = ["up", "right", "down", "left"];
// Players 0/1 keep the directional abcd/ABCD glyphs. Players 2-9 use a single digit (position
// only, direction defaults to "up"); richer config (direction/team/name) comes via options.tanks.
const EXTRA_PLAYER_CHARS = "23456789";

export function parseRawMap(rawMap) {
  if (Array.isArray(rawMap)) return normalizeMap(rawMap);
  const rows = String(rawMap || "").trim().split("|").filter(Boolean);
  const width = rows[0]?.length || 0;
  const height = rows.length;
  const map = Array.from({ length: width }, () => Array.from({ length: height }, () => "."));
  const tanks = [];

  for (let y = 0; y < height; y += 1) {
    const row = rows[y] || "";
    for (let x = 0; x < width; x += 1) {
      const char = row[x] || ".";
      const p1 = PLAYER_ONE.indexOf(char);
      const p2 = PLAYER_TWO.indexOf(char);
      const extra = EXTRA_PLAYER_CHARS.indexOf(char);
      if (p1 >= 0 || p2 >= 0) {
        const index = p1 >= 0 ? 0 : 1;
        tanks[index] = { position: [x, y], direction: DIRECTIONS_BY_CHAR[p1 >= 0 ? p1 : p2] || "up" };
        map[x][y] = ".";
      } else if (extra >= 0) {
        // "2" -> player index 2, "3" -> 3, ...
        tanks[extra + 2] = { position: [x, y], direction: "up" };
        map[x][y] = ".";
      } else {
        map[x][y] = char === "x" || char === "m" || char === "o" ? char : ".";
      }
    }
  }

  return { map, tanks };
}

export function normalizeMap(input) {
  if (!Array.isArray(input) || input.length === 0) return { map: [], tanks: [] };
  if (Array.isArray(input[0])) {
    return { map: input.map((column) => column.slice()), tanks: [] };
  }
  return parseRawMap(input.join("|"));
}

export function mapFromRows(rows) {
  return parseRawMap(rows.join("|")).map;
}

export function openMap(width, height) {
  const map = Array.from({ length: width }, () => Array.from({ length: height }, () => "."));
  for (let x = 0; x < width; x += 1) {
    map[x][0] = "x";
    map[x][height - 1] = "x";
  }
  for (let y = 0; y < height; y += 1) {
    map[0][y] = "x";
    map[width - 1][y] = "x";
  }
  return map;
}

export function cloneMap(map) {
  return map.map((column) => column.slice());
}

export function widthOf(map) {
  return Array.isArray(map) ? map.length : 0;
}

export function heightOf(map) {
  return Array.isArray(map) && map.length > 0 ? map[0].length : 0;
}

export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < widthOf(map) && y < heightOf(map);
}

export function terrainAt(map, x, y) {
  return inBounds(map, x, y) ? map[x][y] : "x";
}

export function blocksMovement(map, x, y) {
  const terrain = terrainAt(map, x, y);
  return terrain === "x" || terrain === "m";
}

export function blocksProjectile(map, x, y) {
  const terrain = terrainAt(map, x, y);
  return terrain === "x" || terrain === "m";
}

export function isGrass(map, x, y) {
  return terrainAt(map, x, y) === "o";
}

export function setTerrain(map, x, y, value) {
  if (inBounds(map, x, y)) map[x][y] = value;
}

export function isSamePoint(a, b) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

export function pointKey(position) {
  return position ? `${position[0]}:${position[1]}` : "";
}
