import fs from 'node:fs';

const dirs = ['up', 'right', 'down', 'left'];
const delta = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

function rot(dir, turn) {
  const i = dirs.indexOf(dir);
  if (i < 0) return dir;
  if (turn === 'left') return dirs[(i + 3) % 4];
  if (turn === 'right') return dirs[(i + 1) % 4];
  return turn || dir;
}

function posText(pos) {
  return pos ? `[${pos[0]},${pos[1]}]` : '-';
}

function readReplay(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return raw.replayData || raw;
}

function findInitialTanks(records) {
  const tanks = new Map();
  for (const frame of records) {
    for (const ev of frame) {
      if (ev.tank && ev.tank.id && !tanks.has(ev.tank.id)) {
        tanks.set(ev.tank.id, {
          id: ev.tank.id,
          by: ev.by,
          pos: ev.tank.position ? ev.tank.position.slice() : null,
          dir: ev.tank.direction || 'up',
          stars: 0,
          crashed: false,
          skill: null,
        });
      }
    }
    if (tanks.size >= 2) break;
  }
  return tanks;
}

function parseLogs(meta) {
  const byFrame = new Map();
  const players = meta.players || [];
  for (let i = 0; i < players.length; i++) {
    for (const log of players[i].logs || []) {
      let text = log.data;
      try {
        text = JSON.parse(log.data);
      } catch {
        // 保留原始文本。
      }
      if (!byFrame.has(log.frame)) byFrame.set(log.frame, []);
      byFrame.get(log.frame).push({ player: i, text });
    }
  }
  return byFrame;
}

function reconstruct(path, opts) {
  const rd = readReplay(path);
  const records = rd.replay.records || [];
  const meta = rd.replay.meta || {};
  const logs = parseLogs(meta);
  const tanks = findInitialTanks(records);
  const tankByPlayer = new Map();
  for (const tank of tanks.values()) {
    if (typeof tank.by === 'number') tankByPlayer.set(tank.by, tank.id);
  }

  let star = null;
  const bullets = new Map();
  const rows = [];
  const names = rd.names || [];

  for (let frame = 0; frame < records.length; frame++) {
    const events = records[frame] || [];
    const before = new Map();
    for (const [id, tank] of tanks.entries()) before.set(id, { ...tank, pos: tank.pos && tank.pos.slice() });

    const notes = [];
    for (const ev of events) {
      if (ev.action === 'created' && ev.type === 'star') {
        star = ev.position ? ev.position.slice() : null;
        notes.push(`star=${posText(star)}`);
      }
      if (ev.action === 'collected') {
        const id = tankByPlayer.get(ev.by);
        const tank = tanks.get(id);
        if (tank) tank.stars += 1;
        star = null;
        notes.push(`P${ev.by}吃星`);
      }
      if (ev.type === 'skill' && ev.action === 'cast') {
        const id = ev.sourceObjectId;
        const tank = tanks.get(id);
        if (tank) tank.skill = ev.skillType;
        notes.push(`P${ev.by} ${ev.skillType}`);
      }
      if (ev.type === 'skill' && ev.action === 'applied' && ev.to && ev.targetObjectId) {
        const tank = tanks.get(ev.targetObjectId);
        if (tank) tank.pos = ev.to.slice();
        notes.push(`${ev.targetObjectId.slice(0, 4)}传${posText(ev.to)}`);
      }
      if (ev.type === 'tank' && ev.action === 'turn') {
        const tank = tanks.get(ev.objectId);
        if (tank) tank.dir = rot(tank.dir, ev.direction);
      }
      if (ev.type === 'tank' && ev.action === 'go') {
        const tank = tanks.get(ev.objectId);
        if (tank) tank.pos = ev.position ? ev.position.slice() : tank.pos;
      }
      if (ev.type === 'bullet' && ev.action === 'created') {
        bullets.set(ev.objectId, {
          id: ev.objectId,
          by: ev.by,
          pos: ev.tank && ev.tank.position ? ev.tank.position.slice() : null,
          dir: ev.direction,
        });
        notes.push(`${ev.tank && ev.tank.id ? ev.tank.id.slice(0, 4) : '?'}开${ev.direction}`);
      }
      if (ev.type === 'bullet' && ev.action === 'go') {
        const bullet = bullets.get(ev.objectId);
        if (bullet) bullet.pos = ev.position ? ev.position.slice() : bullet.pos;
      }
      if (ev.type === 'bullet' && (ev.action === 'hit' || ev.action === 'destroyed')) {
        notes.push(`bullet-${ev.action}`);
      }
      if (ev.type === 'tank' && (ev.action === 'crashed' || ev.action === 'destroyed')) {
        const tank = tanks.get(ev.objectId);
        if (tank) tank.crashed = true;
        notes.push(`${ev.objectId.slice(0, 4)} ${ev.action}`);
      }
      if (ev.type === 'speech') {
        notes.push(`P${ev.by}:${ev.text}`);
      }
    }

    const tankList = [...tanks.values()].sort((a, b) => (a.by ?? 9) - (b.by ?? 9));
    rows.push({
      frame,
      star: star && star.slice(),
      tanks: tankList.map((tank) => {
        const old = before.get(tank.id);
        return {
          by: tank.by,
          name: names[tank.by] || `P${tank.by}`,
          id: tank.id,
          pos: tank.pos && tank.pos.slice(),
          dir: tank.dir,
          stars: tank.stars,
          moved: old && old.pos && tank.pos && (old.pos[0] !== tank.pos[0] || old.pos[1] !== tank.pos[1]),
          crashed: tank.crashed,
        };
      }),
      bullets: [...bullets.values()].map((b) => `${b.dir}${posText(b.pos)}`),
      notes,
      logs: logs.get(frame) || [],
    });
  }

  return { rd, rows };
}

function printRows(path, opts) {
  const { rd, rows } = reconstruct(path, opts);
  const focus = opts.focus ? new Set(opts.focus.split(',').map((v) => Number(v.trim())).filter(Number.isFinite)) : null;
  const from = Number.isFinite(opts.from) ? opts.from : 0;
  const to = Number.isFinite(opts.to) ? opts.to : rows.length - 1;
  console.log(`file=${path}`);
  console.log(`names=${JSON.stringify(rd.names || [])} map=${rd.map && rd.map.name} frames=${rows.length}`);
  for (const row of rows) {
    const hasLog = row.logs.length > 0;
    const hasImportant = row.notes.some((n) => /传|吃星|开|crash|destroy|hit|star=|保分|预射|拦截|守/.test(n));
    if (focus && !focus.has(row.frame)) continue;
    if (!focus && (row.frame < from || row.frame > to) && !hasImportant) continue;
    if (!focus && row.frame < from) continue;
    if (!focus && row.frame > to) continue;
    if (!hasLog && !hasImportant && !opts.all) continue;
    const tankText = row.tanks.map((t) => {
      const crash = t.crashed ? 'X' : '';
      return `P${t.by}${crash}:${posText(t.pos)} ${t.dir} s${t.stars}`;
    }).join(' | ');
    const logText = row.logs.map((l) => `L${l.player}:${l.text}`).join(' || ');
    console.log(`f${row.frame} star=${posText(row.star)} ${tankText}`);
    if (row.notes.length) console.log(`  ev ${row.notes.join(' ; ')}`);
    if (logText) console.log(`  log ${logText}`);
  }
}

const [path, ...args] = process.argv.slice(2);
if (!path) {
  console.error('usage: node replay-summary.mjs <raw.json> [--from N] [--to N] [--focus a,b,c] [--all]');
  process.exit(2);
}
const opts = { all: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') opts.from = Number(args[++i]);
  else if (args[i] === '--to') opts.to = Number(args[++i]);
  else if (args[i] === '--focus') opts.focus = args[++i];
  else if (args[i] === '--all') opts.all = true;
}
printRows(path, opts);
