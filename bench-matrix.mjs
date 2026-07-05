#!/usr/bin/env node
/**
 * Local skill matrix benchmark for all-round tank stability work.
 *
 * Runs bot A against bot B for every skill pair, optionally swapping player
 * order, and reports win rate, crash rate, crash frames, stars, and bad seeds.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AgenTankSimulator,
  loadBotFromCode,
  createRandomScenario
} from "./src/index.js";

const ALL_SKILLS = [
  "teleport",
  "overload",
  "shield",
  "freeze",
  "cloak",
  "poison",
  "stun",
  "boost"
];

const DEFAULTS = {
  botA: "../my-tank/all-round-tank/bt-tank-submit.js",
  botB: "../my-tank/new-tank/bt-tank-submit.js",
  rounds: 20,
  seedStart: 1,
  maxFrames: 300,
  width: 19,
  height: 15,
  timeoutMs: 100,
  skills: ALL_SKILLS
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const cfg = { ...DEFAULTS, ...args };
const codeA = await readFile(resolve(cfg.botA), "utf8");
const codeB = await readFile(resolve(cfg.botB), "utf8");

console.log(`矩阵对拍: ${baseName(cfg.botA)} vs ${baseName(cfg.botB)}`);
console.log(`技能数:${cfg.skills.length}  每格:${cfg.rounds}局  seed:${cfg.seedStart}  maxFrames:${cfg.maxFrames}${cfg.swap ? "  含交换轮" : ""}`);
console.log("=".repeat(92));
console.log("skillA      skillB      side  W-L-D   WR%   crash%  avgStar  badSeeds");
console.log("-".repeat(92));

const matrix = [];

for (const skillA of cfg.skills) {
  for (const skillB of cfg.skills) {
    const normal = await runSeries(skillA, skillB, false);
    matrix.push(normal);
    printRow(normal);

    if (cfg.swap) {
      const swapped = await runSeries(skillA, skillB, true);
      matrix.push(swapped);
      printRow(swapped);
    }
  }
}

const summary = summarize(matrix);
console.log("=".repeat(92));
console.log(`总计: 有效 ${summary.valid}  胜 ${summary.wins}  负 ${summary.losses}  平 ${summary.draws}  WR ${pct(summary.wins, summary.valid)}%  crash ${pct(summary.crashes, summary.valid)}%`);
if (summary.earlyCrashSeeds.length) {
  console.log(`早期崩溃样本: ${summary.earlyCrashSeeds.slice(0, 20).join("  ")}`);
}

if (cfg.save) {
  const outPath = resolve(cfg.save);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: {
      botA: cfg.botA,
      botB: cfg.botB,
      rounds: cfg.rounds,
      seedStart: cfg.seedStart,
      skills: cfg.skills,
      maxFrames: cfg.maxFrames,
      swap: !!cfg.swap
    },
    summary,
    matrix
  }, null, 2), "utf8");
  console.log(`已保存: ${outPath}`);
}

async function runSeries(skillA, skillB, swapped) {
  const records = [];
  let wins = 0, losses = 0, draws = 0, errors = 0, crashes = 0;
  let sumMyStars = 0, sumOppStars = 0, sumMyMs = 0, sumOppMs = 0;

  for (let i = 0; i < cfg.rounds; i += 1) {
    const seed = cfg.seedStart + i;
    const r = await runMatch(seed, skillA, skillB, swapped);
    records.push(r);

    if (r.tag === "W") wins += 1;
    else if (r.tag === "L") losses += 1;
    else if (r.tag === "D") draws += 1;
    else errors += 1;

    if (r.myCrashed) crashes += 1;
    if (r.tag !== "ERROR") {
      sumMyStars += r.myStars;
      sumOppStars += r.oppStars;
      sumMyMs += r.myRunMs;
      sumOppMs += r.oppRunMs;
    }
  }

  const valid = wins + losses + draws;
  return {
    skillA,
    skillB,
    swapped,
    side: swapped ? "P1" : "P0",
    wins,
    losses,
    draws,
    errors,
    crashes,
    valid,
    winRate: valid ? round1(wins / valid * 100) : 0,
    crashRate: valid ? round1(crashes / valid * 100) : 0,
    avgMyStars: valid ? round2(sumMyStars / valid) : 0,
    avgOppStars: valid ? round2(sumOppStars / valid) : 0,
    avgMyMs: valid ? round1(sumMyMs / valid) : 0,
    avgOppMs: valid ? round1(sumOppMs / valid) : 0,
    badSeeds: records.filter((r) => r.tag === "L" || r.myCrashed).map((r) => ({
      seed: r.seed,
      tag: r.tag,
      reason: r.reason,
      myCrashed: r.myCrashed,
      crashFrame: r.crashFrame,
      myStars: r.myStars,
      oppStars: r.oppStars
    })),
    records
  };
}

async function runMatch(seed, skillA, skillB, swapped) {
  const botMy = loadBotFromCode(codeA, { timeoutMs: cfg.timeoutMs });
  const botOpp = loadBotFromCode(codeB, { timeoutMs: cfg.timeoutMs });
  const scenario = createRandomScenario({ width: cfg.width, height: cfg.height, seed });

  const skills = swapped ? [skillB, skillA] : [skillA, skillB];
  const bot0 = swapped ? botOpp : botMy;
  const bot1 = swapped ? botMy : botOpp;
  const myIndex = swapped ? 1 : 0;
  const oppIndex = swapped ? 0 : 1;

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
    return { seed, swapped, skillA, skillB, tag: "ERROR", error: err?.message || String(err) };
  }

  const res = outcome.result || {};
  const myPlayer = sim.players[myIndex];
  const oppPlayer = sim.players[oppIndex];
  const frames = outcome.replayData.replay.records.length;
  const tag = res.winner == null ? "D" : (res.winner === myIndex ? "W" : "L");

  return {
    seed,
    swapped,
    skillA,
    skillB,
    tag,
    reason: res.reason,
    myStars: myPlayer.stars,
    oppStars: oppPlayer.stars,
    myRunMs: round1(myPlayer.runTimeMs),
    oppRunMs: round1(oppPlayer.runTimeMs),
    myCrashed: !!myPlayer.crashed,
    crashFrame: myPlayer.deathFrame ?? (myPlayer.crashed ? frames : null),
    frames
  };
}

function summarize(rows) {
  const total = {
    valid: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    errors: 0,
    crashes: 0,
    earlyCrashSeeds: []
  };
  for (const row of rows) {
    total.valid += row.valid;
    total.wins += row.wins;
    total.losses += row.losses;
    total.draws += row.draws;
    total.errors += row.errors;
    total.crashes += row.crashes;
    for (const b of row.badSeeds) {
      if (b.myCrashed && b.crashFrame != null && b.crashFrame <= 10) {
        total.earlyCrashSeeds.push(`${row.skillA}/${row.skillB}/${row.side}/seed${b.seed}@f${b.crashFrame}`);
      }
    }
  }
  return total;
}

function printRow(row) {
  const badSeeds = row.badSeeds.slice(0, 5).map((b) => {
    const crash = b.myCrashed ? `@f${b.crashFrame}` : "";
    return `${b.seed}${b.tag}${crash}`;
  }).join(",");
  console.log(
    `${padRight(row.skillA, 11)} ${padRight(row.skillB, 11)} ${row.side}   ` +
    `${pad(row.wins, 2)}-${pad(row.losses, 2)}-${pad(row.draws, 2)}  ` +
    `${pad(row.winRate, 5)}  ${pad(row.crashRate, 6)}  ` +
    `${pad(row.avgMyStars, 7)}  ${badSeeds}`
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--bot-a") out.botA = argv[++i];
    else if (a === "--bot-b") out.botB = argv[++i];
    else if (a === "-n" || a === "--rounds") out.rounds = Number(argv[++i]);
    else if (a === "--seed-start") out.seedStart = Number(argv[++i]);
    else if (a === "--max-frames") out.maxFrames = Number(argv[++i]);
    else if (a === "--width") out.width = Number(argv[++i]);
    else if (a === "--height") out.height = Number(argv[++i]);
    else if (a === "--bot-timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--skills") out.skills = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--swap") out.swap = true;
    else if (a === "--save") out.save = argv[++i];
  }
  return out;
}

function usage() {
  return `用法:
  node bench-matrix.mjs --bot-a ../my-tank/all-round-tank/bt-tank-submit.js --bot-b ../my-tank/new-tank/bt-tank-submit.js --rounds 20 --swap

Options:
  --bot-a <path>        我方 bot，默认 ${DEFAULTS.botA}
  --bot-b <path>        对手 bot，默认 ${DEFAULTS.botB}
  -n, --rounds <n>      每个技能组合局数，默认 ${DEFAULTS.rounds}
  --skills <a,b,c>      技能列表，默认 ${ALL_SKILLS.join(",")}
  --seed-start <n>      起始 seed，默认 ${DEFAULTS.seedStart}
  --max-frames <n>      帧上限，默认 ${DEFAULTS.maxFrames}
  --swap                增加先后手交换轮
  --save <file>         保存 JSON 结果，建议写到 D:\\tmp`;
}

function baseName(p) { return p.split(/[\\/]/).pop(); }
function round1(n) { return Math.round(Number(n) * 10) / 10; }
function round2(n) { return Math.round(Number(n) * 100) / 100; }
function pct(n, d) { return d ? round1(n / d * 100) : 0; }
function pad(v, w) { return String(v).padStart(w); }
function padRight(v, w) { return String(v).padEnd(w); }
