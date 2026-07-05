#!/usr/bin/env node
/**
 * bench-ffa.mjs — 本地多人 FFA「一打多」对拍统计
 *
 * 我方坦克(index0) vs N-1 个对手，跑 N 人自由混战(FFA)。统计我方名次分布
 * (1st/2nd/.../last)、平均名次、胜率(=1st 占比)、ERROR/崩溃/超时，用于验证
 * 多敌场景的行为(抽搐/躲弹/多目标狂射)——这是 1v1 bench 测不到的盲区。
 *
 * 用法(在 agentank-simulator 目录下)：
 *   node bench-ffa.mjs --me ../my-tank/myth-survivor/raid-tank-submit.js --players 4 -n 30
 *   node bench-ffa.mjs --me A.js --opp B.js --players 6 -n 20 --skill freeze
 *   node bench-ffa.mjs --players 4 -n 30 --rotate   # 每局轮换我方出生 index,消除位置偏差
 *
 * 默认对手 = 我方同一份代码(self-play FFA)，最能暴露多敌回归。
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgenTankSimulator, loadBotFromCode, createRandomScenario } from "./src/index.js";

const DEFAULTS = {
  me: "../my-tank/myth-survivor/raid-tank-submit.js",
  opp: null,            // null = 用 me 同份代码当对手(self-play FFA)
  players: 4,
  rounds: 30,
  seedStart: 1,
  skill: "freeze",      // 全员同技能(标零点最干净)
  maxFrames: 400,
  width: 21,
  height: 17,
  timeoutMs: 100
};

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(usage()); process.exit(0); }
const cfg = { ...DEFAULTS, ...args };
cfg.players = Math.max(2, Math.floor(cfg.players));

const meCode = await readFile(resolve(cfg.me), "utf8");
const oppCode = cfg.opp ? await readFile(resolve(cfg.opp), "utf8") : meCode;
const meLabel = baseName(cfg.me);
const oppLabel = cfg.opp ? baseName(cfg.opp) : meLabel + "(self)";

console.log(`多人 FFA 对拍：${meLabel}  vs  ${cfg.players - 1}×${oppLabel}`);
console.log(`人数:${cfg.players}  局数:${cfg.rounds}  技能:${cfg.skill}  maxFrames:${cfg.maxFrames}  地图:${cfg.width}x${cfg.height}${cfg.rotate ? "  (轮换出生位)" : ""}`);
console.log("=".repeat(64));

const rankCounts = {};   // 名次 -> 次数
const deathReasons = {}; // 我方死因 -> 次数 (bullet/collision/bomb)
let selfInflicted = 0;   // 我方"自杀"(死因 by==自己 或 collision 无对手参与)粗估
let sumRank = 0, validRounds = 0, errors = 0, myCrashes = 0, myTimeouts = 0, sumMyStars = 0;

for (let i = 0; i < cfg.rounds; i += 1) {
  const seed = cfg.seedStart + i;
  // rotate：我方出生 index 轮换，消除「固定 index0」的位置偏差
  const myIndex = cfg.rotate ? (i % cfg.players) : 0;
  const r = await runMatch(seed, myIndex);

  if (r.tag === "ERROR") {
    errors += 1;
    console.log(`  [${pad(i + 1, 3)}/${cfg.rounds}] ERROR seed=${seed}: ${(r.error || "").slice(0, 80)}`);
    continue;
  }
  validRounds += 1;
  rankCounts[r.myRank] = (rankCounts[r.myRank] || 0) + 1;
  sumRank += r.myRank;
  sumMyStars += r.myStars;
  if (r.myCrashed) myCrashes += 1;
  if (r.myTimeout) myTimeouts += 1;
  if (r.myDeath) {
    deathReasons[r.myDeath.reason] = (deathReasons[r.myDeath.reason] || 0) + 1;
    // collision 双方撞死、bullet 被打死都算"被牵扯"；by==myIndex 的极少见自爆才是纯自杀
    if (r.myDeath.by === r.myIndex) selfInflicted += 1;
  }

  const firsts = rankCounts[1] || 0;
  const wr = validRounds ? (firsts / validRounds * 100) : 0;
  const mark = r.myRank === 1 ? " 🏆" : (r.myCrashed ? " 💥" : "");
  console.log(
    `  [${pad(i + 1, 3)}/${cfg.rounds}] 名次 ${r.myRank}/${cfg.players}  ` +
    `星 ${r.myStars}  死帧 ${r.myDeathFrame == null ? "存活" : r.myDeathFrame}  ` +
    `${r.reason}/${r.frames}f  1st率:${wr.toFixed(1)}%${mark}`
  );
}

console.log("\n" + "=".repeat(64));
console.log("  汇总");
console.log("=".repeat(64));
console.log(`  有效:${validRounds}  错误:${errors}  我方崩溃:${myCrashes}  我方超时:${myTimeouts}`);
const drParts = Object.keys(deathReasons).map((k) => `${k}:${deathReasons[k]}`);
console.log(`  我方死因: ${drParts.length ? drParts.join("  ") : "(无)"}  纯自爆:${selfInflicted}`);
console.log(`  平均名次:${validRounds ? (sumRank / validRounds).toFixed(2) : "-"} / ${cfg.players}  (越小越好,期望值=${((cfg.players + 1) / 2).toFixed(1)})`);
console.log(`  平均星数:${validRounds ? (sumMyStars / validRounds).toFixed(2) : "-"}`);
console.log(`  1st率(胜率):${validRounds ? ((rankCounts[1] || 0) / validRounds * 100).toFixed(1) : "-"}%  (公平期望=${(100 / cfg.players).toFixed(1)}%)`);
const dist = [];
for (let rk = 1; rk <= cfg.players; rk += 1) dist.push(`${rk}名:${rankCounts[rk] || 0}`);
console.log(`  名次分布: ${dist.join("  ")}`);

// ── 跑一局 N 人 FFA ──────────────────────────────────────
async function runMatch(seed, myIndex) {
  const scenario = createRandomScenario({ width: cfg.width, height: cfg.height, seed, count: cfg.players });
  const bots = [];
  for (let idx = 0; idx < cfg.players; idx += 1) {
    const code = (idx === myIndex) ? meCode : oppCode;
    bots.push(loadBotFromCode(code, { timeoutMs: cfg.timeoutMs }));
  }
  const skills = new Array(cfg.players).fill(cfg.skill);

  const sim = new AgenTankSimulator({
    seed, map: scenario.map, tanks: scenario.tanks, skills,
    maxFrames: cfg.maxFrames, starLimit: null, star: scenario.star || null
  });

  let outcome;
  try {
    outcome = await sim.runAsync(bots);
  } catch (err) {
    return { tag: "ERROR", error: err?.message || String(err) };
  }

  const res = outcome.result || {};
  const ranking = res.ranking || [];
  // 名次 = 我方 index 在 ranking 数组里的位置 (1-based)；缺失则按存活兜底排末位
  let myRank = ranking.indexOf(myIndex);
  myRank = myRank >= 0 ? myRank + 1 : cfg.players;
  const myPlayer = sim.players[myIndex];
  const elims = res.eliminations || sim.eliminations || [];
  const myDeath = elims.find((e) => e.index === myIndex) || null;

  return {
    tag: "OK",
    myIndex,
    myRank,
    myStars: myPlayer.stars,
    myCrashed: !!myPlayer.crashed,
    myDeathFrame: myPlayer.deathFrame ?? null,
    myDeath: myDeath ? { reason: myDeath.reason, by: myDeath.by } : null,
    myTimeout: (myPlayer.runTimeMs || 0) > cfg.timeoutMs * (outcome.replayData.replay.records.length || 1),
    reason: res.reason,
    frames: outcome.replayData.replay.records.length
  };
}

// ── helpers ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--me") out.me = argv[++i];
    else if (a === "--opp") out.opp = argv[++i];
    else if (a === "--players" || a === "-p") out.players = Number(argv[++i]);
    else if (a === "-n" || a === "--rounds") out.rounds = Number(argv[++i]);
    else if (a === "--seed-start") out.seedStart = Number(argv[++i]);
    else if (a === "--skill") out.skill = argv[++i];
    else if (a === "--max-frames") out.maxFrames = Number(argv[++i]);
    else if (a === "--width") out.width = Number(argv[++i]);
    else if (a === "--height") out.height = Number(argv[++i]);
    else if (a === "--bot-timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--rotate") out.rotate = true;
  }
  return out;
}
function baseName(p) { return p.split(/[\\/]/).pop(); }
function pad(v, w) { return String(v).padStart(w); }
function usage() {
  return `本地多人 FFA「一打多」对拍统计

用法(在 agentank-simulator 目录下)：
  node bench-ffa.mjs [options]

Options:
  --me <path>          我方 bot(默认 ${DEFAULTS.me})
  --opp <path>         对手 bot(默认 = 我方同份代码 self-play)
  -p, --players <n>    总人数(默认 ${DEFAULTS.players})；我方1 + 对手n-1
  -n, --rounds <n>     局数(默认 ${DEFAULTS.rounds})
  --seed-start <n>     起始 seed(默认 ${DEFAULTS.seedStart})
  --skill <skill>      全员技能(默认 ${DEFAULTS.skill})
  --max-frames <n>     帧上限(默认 ${DEFAULTS.maxFrames})
  --width / --height   地图尺寸(默认 ${DEFAULTS.width}x${DEFAULTS.height})
  --rotate             每局轮换我方出生 index,消除位置偏差`;
}
