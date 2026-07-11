#!/usr/bin/env node
// replay-summary.mjs — 回放关键帧摘要（支持 N 人 / 3v3 团队局）
//
// 用法:
//   node tools/replay-summary.mjs tmp/replay.json
//   node tools/replay-summary.mjs tmp/replay.json --from 20 --to 60
//
// 输出：吃星 / 开火 / 技能 / 炸弹 / 撞毁等关键事件，按帧排列；
// 玩家标注为 P{index}[team]，兼容 1v1（无 team 字段）回放。

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("用法: node tools/replay-summary.mjs <replay.json> [--from N] [--to N]");
  process.exit(1);
}
const fromFrame = intArg("--from", 0);
const toFrame = intArg("--to", Infinity);

const raw = JSON.parse(await readFile(file, "utf8"));
const replay = raw.replayData?.replay || raw.replay || raw;
const records = replay.records || [];
const meta = replay.meta || {};
const players = meta.players || [];
const result = raw.result || meta.result || {};

// objectId → 玩家标签映射（不限于前 2 人）
const labelById = new Map();
players.forEach((p, i) => {
  const team = p.team != null ? `T${p.team}` : "";
  labelById.set(p.tank?.id, `P${i}${team ? "[" + team + "]" : ""}${p.name ? ":" + p.name : ""}`);
});
const labelByIndex = (i) => {
  const p = players[i];
  if (!p) return `P${i}`;
  const team = p.team != null ? `[T${p.team}]` : "";
  return `P${i}${team}`;
};

console.log(`players=${players.length} frames=${records.length}`);
players.forEach((p, i) => {
  console.log(`  ${labelByIndex(i)} start=${JSON.stringify(p.tank?.position)} name=${p.name || "-"}`);
});

for (let frame = 0; frame < records.length; frame += 1) {
  if (frame < fromFrame || frame > toFrame) continue;
  const events = records[frame] || [];
  const lines = [];
  for (const ev of events) {
    const line = describe(ev);
    if (line) lines.push(line);
  }
  if (lines.length) console.log(`f${frame}  ${lines.join("  |  ")}`);
}

const winnerLabel = result.winner != null ? labelByIndex(result.winner) : "draw";
let tail = `result: winner=${winnerLabel} reason=${result.reason || "?"}`;
if (result.ranking) tail += ` ranking=[${result.ranking.map(labelByIndex).join(" > ")}]`;
console.log(tail);
if (result.eliminations?.length) {
  for (const e of result.eliminations) {
    const by = e.by != null ? ` by ${labelByIndex(e.by)}` : "";
    console.log(`  elim f${e.frame}: ${labelByIndex(e.index)} (${e.reason}${by})`);
  }
}

function describe(ev) {
  const who = ev.by != null ? labelByIndex(ev.by) : (labelById.get(ev.objectId) || "");
  switch (`${ev.type}/${ev.action}`) {
    case "star/collected": return `${who} 吃星@${fmt(ev.position)}`;
    case "star/created": return `星生成@${fmt(ev.position)}`;
    case "bullet/created": return `${labelById.get(ev.tank?.id) || who} 开火`;
    case "skill/cast": return `${who} 技能[${ev.skillType}]`;
    case "skill/applied":
      return ev.sourceObjectId === ev.targetObjectId
        ? null // cast 已报，自施加不重复
        : `${who} [${ev.skillType}]命中 ${labelById.get(ev.targetObjectId) || "?"}`;
    case "bomb/created": return `${who} 放雷@${fmt(ev.position)}${ev.hidden ? "(草)" : ""}`;
    case "bomb/exploded": return `${who} 雷爆@${fmt(ev.position)}`;
    case "tank/crashed": return `${labelByIndex(ev.index ?? -1)} 阵亡`;
    case "map/destroyed": return `土堆毁@${fmt(ev.position)}`;
    case "speech/speak": return `${who}「${ev.text}」`;
    default: return null;
  }
}

function fmt(pos) {
  return Array.isArray(pos) ? `${pos[0]},${pos[1]}` : "?";
}

function intArg(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return fallback;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
