#!/usr/bin/env node

import { resolve } from "node:path";
import { dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { AgenTankSimulator, createRandomScenario, loadIsolatedBotFromFile, parseRawMap, serializeRawMap } from "../src/index.js";

const DEFAULT_BOT_TIMEOUT_MS = 100;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(printUsage());
  process.exit(0);
}

// Resolve the bot list: prefer repeatable --bot, fall back to legacy --bot-a/--bot-b.
const botPaths = args.bots.length ? args.bots : [args.botA, args.botB].filter(Boolean);
if (botPaths.length < 2 || (!args.map && !args.randomMap)) {
  console.error(printUsage());
  process.exit(1);
}

const randomSeed = args.seed ?? (args.randomMap ? 1 : undefined);
const scenario = args.randomMap
  ? createRandomScenario({ width: args.width, height: args.height, seed: randomSeed, count: botPaths.length })
  : parseRawMap(args.map);
const initialStar = args.star ? args.star.split(",").map(Number) : scenario.star || null;
const botOptions = { timeoutMs: positiveNumber(args.botTimeoutMs, DEFAULT_BOT_TIMEOUT_MS, "--bot-timeout-ms") };

// Skills: repeatable --skill, else legacy --skill-a/--skill-b, else sensible defaults.
const skills = args.skills.length
  ? args.skills
  : [args.skillA || "teleport", args.skillB || "overload"];
const teams = args.teams.length ? args.teams.map(Number) : undefined;

const bots = await Promise.all(botPaths.map((path) => loadIsolatedBotFromFile(resolve(path), botOptions)));
const sim = new AgenTankSimulator({
  seed: randomSeed == null ? undefined : Number(randomSeed),
  map: scenario.map,
  tanks: scenario.tanks,
  skills,
  teams,
  mode: teams ? "teams" : undefined,
  maxFrames: Number(args.maxFrames || 300),
  starLimit: args.starLimit ? positiveNumber(args.starLimit, null, "--star-limit") : null,
  star: initialStar
});

let result;
try {
  result = await sim.runAsync(bots);
} finally {
  for (const bot of bots) bot.close();
}
const summary = result.result || result.replayData.replay.meta.result;
let line = `winner=${summary.winner ?? "draw"} reason=${summary.reason} frames=${result.replayData.replay.records.length}`;
if (summary.ranking) line += ` ranking=${summary.ranking.join(",")}`;
if (summary.eliminations) line += ` eliminations=${summary.eliminations.length}`;
console.log(line);
if (args.randomMap) {
  console.log(`map=${serializeRawMap(scenario.map, scenario.tanks)}`);
  if (initialStar) console.log(`star=${initialStar.join(",")}`);
}
if (args.out) {
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(result, null, 2));
  console.log(`wrote ${args.out}`);
}

function parseArgs(argv) {
  const out = { bots: [], skills: [], teams: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--bot") out.bots.push(argv[++i]);
    else if (arg === "--bot-a") out.botA = argv[++i];
    else if (arg === "--bot-b") out.botB = argv[++i];
    else if (arg === "--map") out.map = argv[++i];
    else if (arg === "--random-map") out.randomMap = true;
    else if (arg === "--width") out.width = argv[++i];
    else if (arg === "--height") out.height = argv[++i];
    else if (arg === "--seed") out.seed = argv[++i];
    else if (arg === "--skill") out.skills.push(argv[++i]);
    else if (arg === "--team") out.teams.push(argv[++i]);
    else if (arg === "--skill-a") out.skillA = argv[++i];
    else if (arg === "--skill-b") out.skillB = argv[++i];
    else if (arg === "--bot-timeout-ms") out.botTimeoutMs = argv[++i];
    else if (arg === "--max-frames") out.maxFrames = argv[++i];
    else if (arg === "--star-limit") out.starLimit = argv[++i];
    else if (arg === "--star") out.star = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
  }
  return out;
}

function printUsage() {
  return `Usage:
  agentank-simulate-local --bot-a path/to/a.js --bot-b path/to/b.js --map 'a...|....|...A' [options]
  agentank-simulate-local --bot a.js --bot b.js --bot c.js --random-map [options]
  agentank-simulate-local --bot a.js --bot b.js --bot c.js --bot d.js --team 0 --team 0 --team 1 --team 1 --random-map

Options:
  --bot <path>               Add a bot (repeatable; N bots = N-player match)
  --team <id>                Team id for the corresponding --bot (repeatable; enables team mode)
  --skill <skill>            Skill for the corresponding --bot (repeatable)
  --bot-a / --bot-b <path>   Legacy 1v1 bot paths
  --skill-a / --skill-b <s>  Legacy 1v1 skills. Defaults: teleport / overload
  --star <x,y>               Initial star position
  --max-frames <n>           Frame limit. Default: 300
  --star-limit <n>           Optional early win threshold
  --random-map               Generate a deterministic random map
  --width <n>                Random map width. Default: 19
  --height <n>               Random map height. Default: 15
  --seed <n>                 Random seed for map generation and simulator RNG
  --bot-timeout-ms <n>       Per-turn bot timeout. Default: 100
  --out <path>               Write replay-like JSON`;
}

function positiveNumber(value, fallback, name) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}
