#!/usr/bin/env node
/**
 * bench.mjs — 本地批量对拍胜率统计（仿 match_runner.py 风格，但跑本地模拟器）
 *
 * 用本地引擎让 bot-a 对战 bot-b 跑 N 局随机地图（每局换 seed），
 * 统计胜/负/平/胜率，以及双方平均星数、平均累计耗时（平局判据），
 * 用于快速衡量 bt-tank 每次行为改动的收益，无需打线上。
 *
 * 视角：bot-a = 你的坦克（index 0）。winner=0→W，winner=1→L，winner=null→D。
 *
 * 用法（在 agentank-simulator 目录下）：
 *   node bench.mjs                                   # 默认 bt-tank vs walker，20 局
 *   node bench.mjs -n 50                             # 跑 50 局
 *   node bench.mjs --bot-a A.js --bot-b B.js -n 30   # 指定双方 bot
 *   node bench.mjs --seed-start 1000                 # 自定义起始 seed
 *   node bench.mjs --swap                            # 额外跑一轮 A/B 交换先手，消除位置偏差
 *   node bench.mjs --skill-a teleport --skill-b overload
 *   node bench.mjs --max-frames 300 --width 19 --height 15
 *   node bench.mjs --save bench-result.json          # 保存逐局明细
 *   node bench.mjs --quiet                           # 只打汇总
 *
 * 关键：每局重新 loadBotFromCode 建新 sandbox，避免坦克跨帧状态在多局间串味。
 */

import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  AgenTankSimulator,
  loadBotFromCode,
  createRandomScenario
} from "./src/index.js";

const DEFAULTS = {
  botA: "../my-tank/new-tank/bt-tank-submit.js",
  botB: "examples/walker-bot.js",
  rounds: 20,
  seedStart: 1,
  skillA: "teleport",
  skillB: "overload",
  maxFrames: 300,
  width: 19,
  height: 15,
  timeoutMs: 100
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const cfg = { ...DEFAULTS, ...args };
const codeA = await readFile(resolve(cfg.botA), "utf8");
const codeB = await readFile(resolve(cfg.botB), "utf8");

const labelA = baseName(cfg.botA);
const labelB = baseName(cfg.botB);

console.log(`本地批量对拍：${labelA}  vs  ${labelB}`);
console.log(`局数:${cfg.rounds}  技能:[${cfg.skillA}, ${cfg.skillB}]  maxFrames:${cfg.maxFrames}  起始seed:${cfg.seedStart}${cfg.swap ? "  (含交换轮)" : ""}`);
console.log("=".repeat(60));

// 跑一局，返回该局明细。swapped=true 时 codeA 当 index1（先手交换）。
async function runMatch(seed, swapped) {
  // 每局重建 sandbox：坦克状态存在 VM globalThis，复用会串味
  const myCode = codeA;
  const oppCode = codeB;
  const botMy = loadBotFromCode(myCode, { timeoutMs: cfg.timeoutMs });
  const botOpp = loadBotFromCode(oppCode, { timeoutMs: cfg.timeoutMs });

  const scenario = createRandomScenario({ width: cfg.width, height: cfg.height, seed });
  // 我方固定为「player0=我」的视角统计；swapped 时把我放到 index1
  const skills = swapped
    ? [cfg.skillB, cfg.skillA]
    : [cfg.skillA, cfg.skillB];
  const bot0 = swapped ? botOpp : botMy;
  const bot1 = swapped ? botMy : botOpp;

  const sim = new AgenTankSimulator({
    seed,
    map: scenario.map,
    tanks: scenario.tanks,
    skills,
    maxFrames: cfg.maxFrames,
    starLimit: null,
    star: scenario.star || null
  });

  let outcome;
  try {
    outcome = await sim.runAsync(bot0, bot1);
  } catch (err) {
    return { seed, swapped, tag: "ERROR", error: err?.message || String(err) };
  }

  const res = outcome.result || {};
  const myIndex = swapped ? 1 : 0;
  const oppIndex = swapped ? 0 : 1;
  const myPlayer = sim.players[myIndex];
  const oppPlayer = sim.players[oppIndex];

  let tag;
  if (res.winner == null) tag = "D";
  else if (res.winner === myIndex) tag = "W";
  else tag = "L";

  return {
    seed,
    swapped,
    tag,
    reason: res.reason,
    myStars: myPlayer.stars,
    oppStars: oppPlayer.stars,
    myRunMs: round1(myPlayer.runTimeMs),
    oppRunMs: round1(oppPlayer.runTimeMs),
    myCrashed: !!myPlayer.crashed,
    frames: outcome.replayData.replay.records.length
  };
}

async function runSeries(swapped) {
  const records = [];
  let wins = 0, losses = 0, draws = 0, errors = 0, myCrashes = 0;
  let sumMyStars = 0, sumOppStars = 0, sumMyMs = 0, sumOppMs = 0;

  for (let i = 0; i < cfg.rounds; i += 1) {
    const seed = cfg.seedStart + i;
    const r = await runMatch(seed, swapped);
    records.push(r);

    if (r.tag === "W") wins += 1;
    else if (r.tag === "L") losses += 1;
    else if (r.tag === "D") draws += 1;
    else errors += 1;

    if (r.myCrashed) myCrashes += 1;
    if (r.tag !== "ERROR") {
      sumMyStars += r.myStars; sumOppStars += r.oppStars;
      sumMyMs += r.myRunMs; sumOppMs += r.oppRunMs;
    }

    if (!cfg.quiet) {
      const total = wins + losses + draws;
      const wr = total ? (wins / total * 100) : 0;
      if (r.tag === "ERROR") {
        console.log(`  [${pad(i + 1, 3)}/${cfg.rounds}] ERROR seed=${seed}: ${r.error?.slice(0, 80)}`);
      } else {
        const crashMark = r.myCrashed ? " 💥" : "";
        console.log(
          `  [${pad(i + 1, 3)}/${cfg.rounds}] ${r.tag}  seed=${pad(seed, 5)}  ` +
          `星 ${r.myStars}:${r.oppStars}  耗时 ${pad(r.myRunMs, 6)}:${pad(r.oppRunMs, 6)}ms  ` +
          `${r.reason}/${r.frames}f  W:${wins} L:${losses} D:${draws} WR:${wr.toFixed(1)}%${crashMark}`
        );
      }
    }
  }

  const valid = wins + losses + draws;
  return {
    swapped,
    wins, losses, draws, errors, myCrashes,
    valid,
    winRate: valid ? round1(wins / valid * 100) : 0,
    avgMyStars: valid ? round2(sumMyStars / valid) : 0,
    avgOppStars: valid ? round2(sumOppStars / valid) : 0,
    avgMyMs: valid ? round1(sumMyMs / valid) : 0,
    avgOppMs: valid ? round1(sumOppMs / valid) : 0,
    records
  };
}

function printSeriesSummary(title, s) {
  console.log(`\n  ── ${title} ──`);
  console.log(`  有效:${s.valid}  错误:${s.errors}  我方崩溃:${s.myCrashes}`);
  console.log(`  胜 ${s.wins}  负 ${s.losses}  平 ${s.draws}  胜率 ${s.winRate}%`);
  console.log(`  平均星数  我 ${s.avgMyStars} : ${s.avgOppStars} 敌`);
  console.log(`  平均累计耗时  我 ${s.avgMyMs}ms : ${s.avgOppMs}ms 敌`);
}

const seriesNormal = await runSeries(false);
printSeriesSummary(`${labelA} 先手(index0)`, seriesNormal);

let seriesSwap = null;
if (cfg.swap) {
  console.log("\n" + "=".repeat(60));
  console.log(`交换轮：${labelA} 改后手(index1)`);
  console.log("=".repeat(60));
  seriesSwap = await runSeries(true);
  printSeriesSummary(`${labelA} 后手(index1)`, seriesSwap);

  const totW = seriesNormal.wins + seriesSwap.wins;
  const totL = seriesNormal.losses + seriesSwap.losses;
  const totD = seriesNormal.draws + seriesSwap.draws;
  const tot = totW + totL + totD;
  console.log("\n" + "=".repeat(60));
  console.log("  合并汇总（双向，已消除先后手偏差）");
  console.log("=".repeat(60));
  console.log(`  胜 ${totW}  负 ${totL}  平 ${totD}  总胜率 ${tot ? (totW / tot * 100).toFixed(1) : 0}%`);
}

if (cfg.save) {
  const out = {
    generatedAt: new Date().toISOString(),
    config: { botA: cfg.botA, botB: cfg.botB, rounds: cfg.rounds, seedStart: cfg.seedStart,
              skills: [cfg.skillA, cfg.skillB], maxFrames: cfg.maxFrames, swap: !!cfg.swap },
    normal: seriesNormal,
    swap: seriesSwap
  };
  await writeFile(resolve(cfg.save), JSON.stringify(out, null, 2), "utf8");
  console.log(`\n明细已保存: ${cfg.save}`);
}

// ── helpers ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--bot-a") out.botA = argv[++i];
    else if (a === "--bot-b") out.botB = argv[++i];
    else if (a === "-n" || a === "--rounds") out.rounds = Number(argv[++i]);
    else if (a === "--seed-start") out.seedStart = Number(argv[++i]);
    else if (a === "--skill-a") out.skillA = argv[++i];
    else if (a === "--skill-b") out.skillB = argv[++i];
    else if (a === "--max-frames") out.maxFrames = Number(argv[++i]);
    else if (a === "--width") out.width = Number(argv[++i]);
    else if (a === "--height") out.height = Number(argv[++i]);
    else if (a === "--bot-timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--swap") out.swap = true;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--save") out.save = argv[++i];
  }
  return out;
}

function baseName(p) {
  return p.split(/[\\/]/).pop();
}
function round1(n) { return Math.round(Number(n) * 10) / 10; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }
function pad(v, w) { return String(v).padStart(w); }

function usage() {
  return `本地批量对拍胜率统计（跑本地模拟器，仿 match_runner.py）

用法（在 agentank-simulator 目录下）：
  node bench.mjs [options]

Options:
  --bot-a <path>        我方 bot（默认 ${DEFAULTS.botA}）
  --bot-b <path>        对手 bot（默认 ${DEFAULTS.botB}）
  -n, --rounds <n>      局数（默认 ${DEFAULTS.rounds}）
  --seed-start <n>      起始 seed，每局 +1（默认 ${DEFAULTS.seedStart}）
  --skill-a <skill>     我方技能（默认 ${DEFAULTS.skillA}）
  --skill-b <skill>     对手技能（默认 ${DEFAULTS.skillB}）
  --max-frames <n>      帧上限（默认 ${DEFAULTS.maxFrames}）
  --width / --height    随机地图尺寸（默认 ${DEFAULTS.width}x${DEFAULTS.height}）
  --bot-timeout-ms <n>  每帧超时（默认 ${DEFAULTS.timeoutMs}）
  --swap                额外跑一轮先后手交换，合并汇总消除位置偏差
  --quiet               只打汇总，不打逐局
  --save <file>         保存逐局明细 JSON`;
}
