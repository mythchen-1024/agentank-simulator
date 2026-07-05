function onIdle(me, enemy, game) {
  if (!enemy || !enemy.tank || !enemy.tank.position) {
    me.go();
    return;
  }

  const my = me.tank.position;
  const en = enemy.tank.position;
  const shotDir = overloadShotDir(my, en, game);
  const ready = me.skill && me.skill.remainingCooldownFrames === 0;
  const active = me.status && me.status.overloaded;

  if (shotDir && manhattan(my, en) <= 7) {
    if (ready && !active) {
      me.overload();
      return;
    }
    if (me.tank.direction === shotDir) {
      me.fire();
      return;
    }
    turnToward(me, shotDir);
    return;
  }

  const target = choosePressureStep(my, en, game);
  if (target) {
    const dir = directionBetween(my, target);
    if (dir === me.tank.direction) me.go();
    else if (dir) turnToward(me, dir);
    else me.turn("right");
    return;
  }

  me.turn("right");
}

function overloadShotDir(from, target, game) {
  const dx = target[0] - from[0];
  const dy = target[1] - from[1];
  if (dx === 0 && clearBetween(from, target, game)) return dy > 0 ? "down" : "up";
  if (dy === 0 && clearBetween(from, target, game)) return dx > 0 ? "right" : "left";
  // overload 副弹固定从开火方向的 +1 行/列生成；这里主动用副弹打相邻线。
  if (dx === 1 && clearBetween([from[0] + 1, from[1]], target, game)) return dy > 0 ? "down" : "up";
  if (dy === 1 && clearBetween([from[0], from[1] + 1], target, game)) return dx > 0 ? "right" : "left";
  return null;
}

function choosePressureStep(my, en, game) {
  const dirs = [
    { name: "up", dx: 0, dy: -1 },
    { name: "right", dx: 1, dy: 0 },
    { name: "down", dx: 0, dy: 1 },
    { name: "left", dx: -1, dy: 0 },
  ];
  let best = null;
  let bestScore = -99999;
  for (const d of dirs) {
    const p = [my[0] + d.dx, my[1] + d.dy];
    if (!isPassable(game, p, en)) continue;
    const dx = Math.abs(p[0] - en[0]);
    const dy = Math.abs(p[1] - en[1]);
    let score = -manhattan(p, en) * 4;
    if (dx <= 1 || dy <= 1) score += 30;
    if (dx === 1 || dy === 1) score += 20;
    if (manhattan(p, en) < 2) score -= 20;
    if (game.star) score -= manhattan(p, game.star) * 0.2;
    if (d.name === directionBetween(my, p)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function isPassable(game, p, enemyPos) {
  if (!p || p[0] < 0 || p[1] < 0 || p[0] >= game.map.length || p[1] >= game.map[0].length) return false;
  if (enemyPos && p[0] === enemyPos[0] && p[1] === enemyPos[1]) return false;
  const t = game.map[p[0]] && game.map[p[0]][p[1]];
  return t === "." || t === "o";
}

function clearBetween(a, b, game) {
  if (a[0] !== b[0] && a[1] !== b[1]) return false;
  const sx = Math.sign(b[0] - a[0]);
  const sy = Math.sign(b[1] - a[1]);
  let x = a[0] + sx;
  let y = a[1] + sy;
  while (x !== b[0] || y !== b[1]) {
    const t = game.map[x] && game.map[x][y];
    if (t === "x" || t === "m") return false;
    x += sx;
    y += sy;
  }
  return true;
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function directionBetween(a, b) {
  if (a[0] === b[0]) return b[1] > a[1] ? "down" : (b[1] < a[1] ? "up" : null);
  if (a[1] === b[1]) return b[0] > a[0] ? "right" : "left";
  return null;
}

function turnToward(me, dir) {
  const order = ["up", "right", "down", "left"];
  const cur = order.indexOf(me.tank.direction);
  const tgt = order.indexOf(dir);
  const diff = (tgt - cur + 4) % 4;
  me.turn(diff === 3 ? "left" : "right");
}
