import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgenTankSimulator,
  IsolatedBotRunner,
  createRandomScenario,
  loadBotFromCode,
  loadIsolatedBotFromFile,
  mapFromRows,
  openMap,
  parseRawMap,
  serializeRawMap
} from "../src/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SIMULATE_LOCAL_CLI = fileURLToPath(new URL("../bin/simulate-local.mjs", import.meta.url));

testFrameOrderMovesPlayersBeforeBullets();
testMovingIntoOccupiedCellIsBlockedEvenIfOpponentWouldLeave();
testSwapMoveIsBlockedForBothTanks();
testBulletMovesTwoCellsAndBreaksDirt();
testReplayExportKeepsInitialMapAfterDirtBreak();
testThrowBombPlacesVisibleBombAndCooldown();
testGrassBombHiddenFromEnemySnapshot();
testBombExplosionDestroysDirtStopsAtStoneAndHitsTanks();
await testBotRunnerExposesThrowBombAsCommonAction();
testTeleportMovesImmediatelyAndStartsCooldown();
testInvalidTeleportConsumesCooldown();
testTeleportCannotLandOnEnemyBullet();
testTeleportToStarLandsOnAdjacentCell();
testTeleportStarPickupWaitsTwoFrames();
testTeleportNearEnemyFireLocksForTwoFrames();
testSnapshotMatchesDocumentedRuntimeShape();
await testBotOnlyExposesOwnedSkillMethod();
await testAgentSpeakPrintUseLogsWithoutConsumingAction();
await testBotTimeoutDoesNotHang();
testAsyncBotTimeoutDoesNotHang();
await testAsyncBotRejectionReturnsErrorDecision();
testCloakHidesEnemyTankFromOpponent();
testTeleportLandingRevealsTankInGrass();
testCloakedTankCanStillBeShot();
testFreezeControlsEnemyForTwoFrames();
testGlobalDebuffSkillsApplyThroughDistanceAndWalls();
testStunRandomizesControlsAndExposesStatus();
testPoisonSlowsActionCadenceForFourFrames();
testShieldBlocksTwoBulletsBeforeBreaking();
testShieldFirstHitKeepsShield();
testBoostMovesUpToTwoTilesPerGo();
testOverloadStatusDurationAndExpiry();
testOverloadFireCreatesTwoBulletsAndExpires();
testVisibleBulletCanExposeOverloadSpreadBullet();
testEnemyBulletVisibilityUsesForwardCone();
testEnemyBulletVisibilityIsBlockedByTerrain();
testSeededStarSpawnIsDeterministic();
testDefaultStarCollectionDoesNotEndMatch();
testConfiguredWinningStarDoesNotSpawnReplacement();
testDoubleKillTieBreaksByStarsThenRuntime();
testDoubleKillTieBreaksByRuntimeWhenStarsTie();
testCrashResultIsNotOverriddenByStarLimit();
testStarProviderSeesCurrentPlayerStatus();
testRawMapParsingKeepsStartsAndTerrain();
testRandomScenarioGenerationIsSeeded();
testSimulatorRejectsMapsWithMissingTankStart();
testSimulateLocalPassesConfiguredBotTimeout();
testSimulateLocalRandomMapMode();
await testIsolatedBotRunnerBlocksHostFileAccess();
await testIsolatedBotRunnerClosesWorkerAfterInitError();

testFfaSnapshotShape();
testPrimaryOpponentThreatScoreSelection();
testSingleTargetSkillHitsPrimaryOnly();
testTeleportFireLockTargetsPrimaryOnly();
testTeammatesCannotShareCell();
testTeammateBulletsPassThrough();
testFfaTanksAreMutualEnemies();
testFfaEndsWhenOneSurvivorRemains();
testTeamsEndWhenOneTeamWiped();
testFfaFrameLimitRankingByStars();
testTeamsRankingByTotalStars();
testEliminationsRecordCauseAndKiller();
await testTeamChatDeliversNextFrameToTeammatesOnly();
await testTeamChatConstraintsDropExtraOversizeAndInvalid();
await testIsolatedRunnerCarriesTeamInfo();
await testRunAcceptsArrayAndVariadicBots();
testCloneIsDeterministicForMultiplayer();
testRawMapParsesNumericExtraTanks();

console.log("simulator check passed");

function testFrameOrderMovesPlayersBeforeBullets() {
  const map = openMap(7, 5);
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [4, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.bullets.push({
    objectId: "shot",
    ownerIndex: 1,
    ownerObjectId: "b",
    position: [3, 2],
    direction: "left",
    crashed: false
  });
  const events = sim.step([{ type: "go" }, { type: "turn", side: "right" }]);
  assert.deepEqual(events.slice(0, 2).map((event) => event.type + ":" + event.action), ["tank:go", "tank:turn"]);
  assert.equal(events[2].type, "bullet");
  assert.equal(sim.players[0].crashed, false, "player should move before the old bullet advances");
}

function testBulletMovesTwoCellsAndBreaksDirt() {
  const map = openMap(8, 5);
  map[4][2] = "m";
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [6, 3], direction: "left", skillType: "overload" }
    ]
  });
  const events = sim.step([{ type: "fire" }, null]);
  assert.equal(events.filter((event) => event.type === "bullet" && event.action === "go").length, 2);
  assert.deepEqual(events.find((event) => event.type === "map"), { type: "map", action: "destroyed", position: [4, 2] });
  assert.equal(sim.map[4][2], ".");
}

function testReplayExportKeepsInitialMapAfterDirtBreak() {
  const map = openMap(8, 5);
  map[4][2] = "m";
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [6, 3], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "fire" }, null]);
  const replay = sim.toReplayData();
  assert.equal(sim.map[4][2], ".");
  assert.equal(replay.replayData.map.map[4][2], "m");
}

function testThrowBombPlacesVisibleBombAndCooldown() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  let events = sim.step([{ type: "throwBomb" }, null]);
  assert.equal(events.some((event) => event.type === "bomb" && event.action === "created"), true);
  assert.equal(sim.snapshotFor(0).me.status.bombActive, true);
  assert.equal(sim.snapshotFor(0).game.bombs.length, 1);
  assert.equal(sim.snapshotFor(1).game.bombs.length, 1);
  for (let i = 0; i < 10; i += 1) events = sim.step([null, null]);
  assert.equal(events.some((event) => event.type === "bomb" && event.action === "exploded"), true);
  assert.equal(sim.snapshotFor(0).me.status.bombActive, false);
  assert.equal(sim.snapshotFor(0).me.status.bombCooldownFrames, 10);
}

function testGrassBombHiddenFromEnemySnapshot() {
  const map = openMap(9, 7);
  map[2][2] = "o";
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "throwBomb" }, null]);
  assert.equal(sim.snapshotFor(0).game.bombs.length, 1);
  assert.equal(sim.snapshotFor(1).game.bombs.length, 0);
}

function testBombExplosionDestroysDirtStopsAtStoneAndHitsTanks() {
  const map = openMap(9, 7);
  map[4][2] = "m";
  map[5][2] = "m";
  map[1][2] = "x";
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [3, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "throwBomb" }, null]);
  let events = [];
  for (let i = 0; i < 10; i += 1) events = sim.step([null, null]);
  assert.equal(events.some((event) => event.type === "map" && event.action === "destroyed" && event.position[0] === 4 && event.position[1] === 2), true);
  assert.equal(sim.map[4][2], ".");
  assert.equal(sim.map[5][2], "m");
  assert.equal(sim.players[0].crashed, true);
  assert.equal(sim.players[1].crashed, true);
}

async function testBotRunnerExposesThrowBombAsCommonAction() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  const bot = loadBotFromCode(`
    function onIdle(me) {
      me.throwBomb();
    }
  `);
  const decision = bot.decide(sim.snapshotFor(0));
  assert.deepEqual(decision.action, { type: "throwBomb" });
}

function testMovingIntoOccupiedCellIsBlockedEvenIfOpponentWouldLeave() {
  const sim = new AgenTankSimulator({
    map: openMap(8, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [3, 2], direction: "right", skillType: "overload" }
    ]
  });
  sim.step([{ type: "go" }, { type: "go" }]);
  assert.deepEqual(sim.players[0].position, [2, 2]);
  assert.deepEqual(sim.players[1].position, [4, 2]);
}

function testSwapMoveIsBlockedForBothTanks() {
  const sim = new AgenTankSimulator({
    map: openMap(8, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "teleport" },
      { id: "b", position: [3, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "go" }, { type: "go" }]);
  assert.deepEqual(sim.players[0].position, [2, 2]);
  assert.deepEqual(sim.players[1].position, [3, 2]);
}

function testTeleportMovesImmediatelyAndStartsCooldown() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  const events = sim.step([{ type: "teleport", x: 4, y: 4 }, null]);
  assert.deepEqual(sim.players[0].position, [4, 4]);
  assert.equal(sim.snapshotFor(0).me.skill.remainingCooldownFrames, 40);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.skillType === "teleport"), true);
}

function testInvalidTeleportConsumesCooldown() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "teleport", x: 7, y: 5 }, null]);
  assert.deepEqual(sim.players[0].position, [1, 1]);
  assert.equal(sim.snapshotFor(0).me.skill.remainingCooldownFrames, 40);
}

function testTeleportCannotLandOnEnemyBullet() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.bullets.push({ objectId: "enemy-shot", ownerIndex: 1, ownerObjectId: "b", position: [4, 4], direction: "up", crashed: false });
  sim.step([{ type: "teleport", x: 4, y: 4 }, null]);
  assert.deepEqual(sim.players[0].position, [1, 1]);
  assert.equal(sim.snapshotFor(0).me.skill.remainingCooldownFrames, 40);
}

function testTeleportToStarLandsOnAdjacentCell() {
  const sim = new AgenTankSimulator({
    seed: 7,
    star: [4, 4],
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  const events = sim.step([{ type: "teleport", x: 4, y: 4 }, null]);
  assert.notDeepEqual(sim.players[0].position, [4, 4]);
  assert.equal(manhattan(sim.players[0].position, [4, 4]), 1);
  const applied = events.find((event) => event.type === "skill" && event.action === "applied" && event.skillType === "teleport");
  assert.deepEqual(applied.requestedTo, [4, 4]);
  assert.deepEqual(applied.to, sim.players[0].position);
  assert.equal(sim.players[0].stars, 0);
  assert.deepEqual(sim.star, [4, 4]);
}

function testTeleportStarPickupWaitsTwoFrames() {
  const sim = new AgenTankSimulator({
    star: [4, 4],
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "teleport", x: 4, y: 4 }, null]);
  sim.players[0].position = [4, 4];
  let events = sim.step([null, null]);
  assert.equal(events.some((event) => event.type === "star" && event.action === "collected"), false);
  events = sim.step([null, null]);
  assert.equal(events.some((event) => event.type === "star" && event.action === "collected"), false);
  events = sim.step([null, null]);
  assert.equal(events.some((event) => event.type === "star" && event.action === "collected" && event.by === 0), true);
  assert.equal(sim.players[0].stars, 1);
}

function testTeleportNearEnemyFireLocksForTwoFrames() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [8, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "teleport", x: 5, y: 5 }, null]);
  assert.equal(sim.snapshotFor(0).me.status.fireLocked, true);
  let events = sim.step([{ type: "fire" }, null]);
  assert.equal(events.some((event) => event.type === "bullet" && event.action === "created" && event.tank.id === "a"), false);
  events = sim.step([{ type: "fire" }, null]);
  assert.equal(events.some((event) => event.type === "bullet" && event.action === "created" && event.tank.id === "a"), false);
  events = sim.step([{ type: "fire" }, null]);
  assert.equal(events.some((event) => event.type === "bullet" && event.action === "created" && event.tank.id === "a"), true);
}

function testSnapshotMatchesDocumentedRuntimeShape() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "overload" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  sim.step([{ type: "overload" }, null]);
  const snap = sim.snapshotFor(0).me;
  assert.equal(snap.skill.cooldownFrames, 32);
  assert.equal(snap.skill.activeRemainingFrames, 9);
  assert.equal(snap.effects.self.remainingFrames, 9);
  assert.equal(snap.status.actionSpeed, 1);
  assert.equal(snap.status.canActThisFrame, true);
}

async function testBotOnlyExposesOwnedSkillMethod() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const seen = [];
  const bot = loadBotFromCode(`
    function onIdle(me) {
      print(typeof me.teleport + "," + typeof me.cloak + "," + typeof me.overload);
    }
  `);
  const decision = bot.decide(sim.snapshotFor(0));
  seen.push(decision.logs[0].data);
  assert.deepEqual(seen, ["function,undefined,undefined"]);

  const freezeSim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "freeze" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const freezeBot = loadBotFromCode(`
    function onIdle(me) {
      print(typeof me.freeze + "," + typeof me.teleport + "," + typeof me.cloak + "," + typeof me.overload);
    }
  `);
  const freezeDecision = freezeBot.decide(freezeSim.snapshotFor(0));
  assert.equal(freezeDecision.logs[0].data, "function,undefined,undefined,undefined");

  const poisonSim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "poison" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const poisonBot = loadBotFromCode(`
    function onIdle(me) {
      print(typeof me.poison + "," + typeof me.stun + "," + typeof me.shield + "," + typeof me.boost);
    }
  `);
  const poisonDecision = poisonBot.decide(poisonSim.snapshotFor(0));
  assert.equal(poisonDecision.logs[0].data, "function,undefined,undefined,undefined");
}

async function testAgentSpeakPrintUseLogsWithoutConsumingAction() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport", stars: 2 },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const bot = loadBotFromCode(`
    function onIdle(me) {
      me.speak("hello");
      me.print("stars", me.stars);
      me.go();
    }
  `);
  const decision = bot.decide(sim.snapshotFor(0));
  assert.deepEqual(decision.action, { type: "go" });
  assert.deepEqual(decision.logs, [
    { type: "speak", data: "hello" },
    { type: "print", data: "stars 2" }
  ]);
}

async function testBotTimeoutDoesNotHang() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const bot = loadBotFromCode(`
    function onIdle() {
      while (true) {}
    }
  `, { timeoutMs: 5 });
  const decision = bot.decide(sim.snapshotFor(0));
  assert.equal(decision.action.type, "timeout");
  assert.equal(decision.runtimeMs < 100, true);
}

function testAsyncBotTimeoutDoesNotHang() {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { AgenTankSimulator, loadBotFromCode, openMap } from "./src/index.js";
    const sim = new AgenTankSimulator({
      map: openMap(10, 7),
      tanks: [
        { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
        { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
      ]
    });
    const bot = loadBotFromCode(\`
      async function onIdle() {
        await Promise.resolve();
        while (true) {}
      }
    \`, { timeoutMs: 5 });
    const decision = bot.decide(sim.snapshotFor(0));
    console.log(decision.action.type);
  `], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    timeout: 500
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.stdout.trim(), "timeout");
}

async function testAsyncBotRejectionReturnsErrorDecision() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const bot = loadBotFromCode(`
      async function onIdle() {
        await Promise.resolve();
        throw new Error("async boom");
      }
    `, { timeoutMs: 50 });
    const decision = await bot.decide(sim.snapshotFor(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(decision.action.type, "error");
    assert.match(decision.action.message, /async boom/);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
}

function testCloakHidesEnemyTankFromOpponent() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "cloak" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "cloak" }, null]);
  assert.equal(sim.snapshotFor(1).enemy.tank, null);
  assert.notEqual(sim.snapshotFor(0).me.tank, null);
}

function testTeleportLandingRevealsTankInGrass() {
  const map = openMap(9, 7);
  map[4][3] = "o"; // grass landing spot
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [7, 5], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "teleport", x: 4, y: 3 }, null]);
  const revealed = sim.snapshotFor(1).enemy.tank;
  assert.notEqual(revealed, null, "teleport landing in grass should be briefly revealed to the enemy");
  assert.deepEqual(revealed.position, [4, 3], "revealed position is the teleport landing spot");
  sim.step([null, null]);
  assert.equal(sim.snapshotFor(1).enemy.tank, null, "after the reveal window grass hides the tank again");
}

function testCloakedTankCanStillBeShot() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "teleport" },
      { id: "b", position: [4, 3], direction: "left", skillType: "cloak" }
    ]
  });
  sim.step([null, { type: "cloak" }]);
  assert.equal(sim.snapshotFor(0).enemy.tank, null);
  sim.step([{ type: "fire" }, null]);
  sim.step([null, null]);
  assert.equal(sim.players[1].crashed, true);
  assert.equal(sim.result.winner, 0);
}

function testFreezeControlsEnemyForTwoFrames() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "freeze" },
      { id: "b", position: [5, 3], direction: "left", skillType: "cloak" }
    ]
  });
  let events = sim.step([{ type: "freeze" }, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.skillType === "freeze"), true);
  assert.deepEqual(sim.players[1].position, [5, 3]);
  assert.equal(sim.snapshotFor(1).me.status.frozen, true);

  events = sim.step([null, { type: "go" }]);
  assert.deepEqual(sim.players[1].position, [5, 3]);
  assert.equal(events.some((event) => event.type === "tank" && event.objectId === "b" && event.action === "go"), false);

  events = sim.step([null, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "expired" && event.skillType === "freeze"), true);
  assert.deepEqual(sim.players[1].position, [4, 3]);
}

function testGlobalDebuffSkillsApplyThroughDistanceAndWalls() {
  const cases = [
    { skill: "freeze", status: "frozen" },
    { skill: "stun", status: "stunned" },
    { skill: "poison", status: "poisoned" }
  ];
  for (const { skill, status } of cases) {
    const map = openMap(18, 9);
    map[8][4] = "x";
    const sim = new AgenTankSimulator({
      map,
      tanks: [
        { id: "a", position: [1, 4], direction: "up", skillType: skill },
        { id: "b", position: [16, 4], direction: "left", skillType: "cloak" }
      ]
    });
    const events = sim.step([{ type: skill }, null]);
    assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.skillType === skill), true);
    assert.equal(sim.snapshotFor(1).me.status[status], true);
  }
}

function testStunRandomizesControlsAndExposesStatus() {
  const sim = new AgenTankSimulator({
    seed: 1,
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "stun" },
      { id: "b", position: [4, 3], direction: "up", skillType: "cloak" }
    ]
  });
  let events = sim.step([{ type: "stun" }, { type: "turn", side: "left" }]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.skillType === "stun"), true);
  assert.equal(sim.snapshotFor(0).me.skill.remainingCooldownFrames, 20);
  assert.equal(sim.snapshotFor(1).me.status.stunned, true);
  let firstTurn = null;
  for (let i = 0; i < 6; i += 1) {
    events = sim.step([null, { type: "turn", side: "left" }]);
    const turn = events.find((event) => event.type === "tank" && event.objectId === "b" && event.action === "turn");
    if (!firstTurn) firstTurn = turn;
    assert.equal(sim.snapshotFor(1).me.status.stunned, true);
  }
  assert.equal(firstTurn.direction, "left");
  assert.equal(firstTurn.stunReversed, false);
  sim.step([null, { type: "turn", side: "left" }]);
  assert.equal(sim.snapshotFor(1).me.status.stunned, false);
}

function testPoisonSlowsActionCadenceForFourFrames() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 9),
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "poison" },
      { id: "b", position: [4, 3], direction: "down", skillType: "cloak" }
    ]
  });
  let events = sim.step([{ type: "poison" }, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.skillType === "poison"), true);
  assert.equal(sim.snapshotFor(1).me.status.poisoned, true);
  assert.equal(sim.snapshotFor(1).me.status.actionSpeed, 0.5);

  events = sim.step([null, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "tank" && event.objectId === "b" && event.action === "go"), false);
  assert.equal(sim.snapshotFor(1).me.status.canActThisFrame, true);

  events = sim.step([null, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "tank" && event.objectId === "b" && event.action === "go"), true);
  assert.equal(sim.snapshotFor(1).me.status.canActThisFrame, false);

  events = sim.step([null, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "tank" && event.objectId === "b" && event.action === "go"), false);
  assert.equal(sim.snapshotFor(1).me.status.canActThisFrame, true);

  events = sim.step([null, { type: "go" }]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "expired" && event.skillType === "poison"), true);
  assert.equal(events.some((event) => event.type === "tank" && event.objectId === "b" && event.action === "go"), true);
  assert.equal(sim.snapshotFor(1).me.status.poisoned, false);
}

function testShieldBlocksTwoBulletsBeforeBreaking() {
  // shield-two-hit(2026-06-27)：护盾挡 2 发才碎(原 1 发)。
  // 注:单攻击者因 3 帧开火锁+2格/帧弹速,无法在 4 帧盾窗内打 2 发(第 2 发到达时盾已按时过期),
  //   所以用两侧夹击同帧命中验证"挡 2 发才碎"。
  // 几何:b[4,3]开盾; a[4,1]朝下、c[4,5]朝上,各距 2 格,同帧开火→子弹同帧命中 [4,3]。
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [4, 1], direction: "down", skillType: "overload" },
      { id: "b", position: [4, 3], direction: "left", skillType: "shield" },
      { id: "c", position: [4, 5], direction: "up", skillType: "overload" }
    ]
  });
  sim.step([null, { type: "shield" }, null]);
  assert.equal(sim.snapshotFor(1).me.status.shielded, true);
  assert.equal(sim.players[1].effects.self.hitsRemaining, 2, "刚开盾应有 2 次挡弹");
  assert.equal(sim.snapshotFor(1).me.skill.remainingCooldownFrames, 25,
    "盾冷却应为 25 帧(2026-06-27 校准,与平台一致)");

  // a、c 同帧开火,两弹同帧飞抵 b 的 [4,3]
  const ev = sim.step([{ type: "fire" }, null, { type: "fire" }]);
  assert.equal(sim.players[1].crashed, false, "两发都被盾吸收,b 不死(证明挡 2 发)");
  assert.equal(sim.snapshotFor(1).me.status.shielded, false, "挡满 2 发后盾碎");
  assert.equal(ev.some((e) => e.type === "skill" && e.action === "expired" && e.skillType === "shield"), true,
    "第 2 发触发盾 expired");
}

function testShieldFirstHitKeepsShield() {
  // 单发命中:盾不碎、剩 1 次挡弹(对比旧版 1 发即碎)
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "overload" },
      { id: "b", position: [4, 3], direction: "left", skillType: "shield" }
    ]
  });
  sim.step([null, { type: "shield" }]);
  sim.step([{ type: "fire" }, null]);
  const ev1 = sim.step([null, null]); // 子弹命中
  assert.equal(sim.players[1].crashed, false, "第 1 发被盾挡,b 不死");
  assert.equal(sim.players[1].effects.self?.type, "shield", "第 1 发后盾仍在(不再 1 发就碎)");
  assert.equal(sim.players[1].effects.self.hitsRemaining, 1, "第 1 发后剩 1 次挡弹");
  assert.equal(ev1.some((e) => e.type === "skill" && e.action === "expired" && e.skillType === "shield"), false,
    "第 1 发不应触发盾 expired");
}

function testBoostMovesUpToTwoTilesPerGo() {
  const map = openMap(10, 7);
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "boost" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  sim.step([{ type: "boost" }, null]);
  assert.equal(sim.snapshotFor(0).me.status.boosted, true);
  assert.equal(sim.snapshotFor(0).me.skill.remainingCooldownFrames, 26);
  sim.step([{ type: "go" }, null]);
  assert.deepEqual(sim.players[0].position, [3, 3]);

  const blockedMap = openMap(10, 7);
  blockedMap[3][3] = "m";
  const blocked = new AgenTankSimulator({
    map: blockedMap,
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "boost" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  blocked.step([{ type: "boost" }, null]);
  blocked.step([{ type: "go" }, null]);
  assert.deepEqual(blocked.players[0].position, [2, 3]);

  const freeTurn = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [1, 3], direction: "right", skillType: "boost" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  freeTurn.step([{ type: "boost" }, null]);
  const events = freeTurn.step([{ type: "turnGo", side: "left" }, null]);
  assert.equal(freeTurn.players[0].direction, "up");
  assert.deepEqual(freeTurn.players[0].position, [1, 1]);
  assert.equal(events.some((event) => event.type === "tank" && event.action === "turn" && event.free), true);
}

function testOverloadStatusDurationAndExpiry() {
  const sim = new AgenTankSimulator({
    map: openMap(9, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "overload" },
      { id: "b", position: [7, 5], direction: "left", skillType: "cloak" }
    ]
  });
  let events = sim.step([{ type: "overload" }, null]);
  assert.equal(sim.snapshotFor(0).me.status.overloaded, true);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "applied" && event.durationFrames === 10), true);
  for (let i = 0; i < 9; i += 1) sim.step([null, null]);
  events = sim.step([null, null]);
  assert.equal(sim.snapshotFor(0).me.status.overloaded, false);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "expired" && event.skillType === "overload"), true);
}

function testOverloadFireCreatesTwoBulletsAndExpires() {
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "overload" },
      { id: "b", position: [8, 5], direction: "left", skillType: "cloak" }
    ]
  });
  sim.step([{ type: "overload" }, null]);
  const events = sim.step([{ type: "fire" }, null]);
  assert.equal(events.filter((event) => event.type === "bullet" && event.action === "created").length, 2);
  assert.deepEqual(sim.bullets.map((bullet) => bullet.position), [[3, 1], [3, 2]]);
  assert.equal(events.some((event) => event.type === "skill" && event.action === "expired" && event.skillType === "overload"), true);
  assert.equal(sim.snapshotFor(0).me.status.overloaded, false);
}

function testVisibleBulletCanExposeOverloadSpreadBullet() {
  const map = openMap(10, 7);
  map[4][1] = "x";
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "overload" },
      { id: "b", position: [7, 2], direction: "left", skillType: "cloak" }
    ]
  });
  sim.step([{ type: "overload" }, null]);
  sim.step([{ type: "fire" }, null]);
  assert.deepEqual(sim.snapshotFor(1).enemy.bullet.position, [3, 2]);
}

function testEnemyBulletVisibilityUsesForwardCone() {
  assert.deepEqual(visibleEnemyBulletSnapshot("up", [5, 2]), [5, 2], "straight ahead should be visible");
  assert.deepEqual(visibleEnemyBulletSnapshot("up", [3, 3]), [3, 3], "left 45 degree boundary should be visible");
  assert.deepEqual(visibleEnemyBulletSnapshot("up", [7, 3]), [7, 3], "right 45 degree boundary should be visible");
  assert.equal(visibleEnemyBulletSnapshot("up", [2, 4]), null, "outside the 90 degree cone should be hidden");
  assert.equal(visibleEnemyBulletSnapshot("up", [5, 7]), null, "behind the observer should be hidden");
  assert.equal(visibleEnemyBulletSnapshot("up", [2, 5]), null, "same-row side bullets should be hidden");

  assert.deepEqual(visibleEnemyBulletSnapshot("right", [8, 2]), [8, 2], "rotated cone boundary should be visible");
  assert.equal(visibleEnemyBulletSnapshot("right", [4, 5]), null, "rotated cone should still hide behind bullets");
}

function testEnemyBulletVisibilityIsBlockedByTerrain() {
  assert.deepEqual(visibleEnemyBulletSnapshot("right", [8, 5]), [8, 5], "open line should expose bullets inside the cone");
  assert.equal(visibleEnemyBulletSnapshot("right", [8, 5], { terrain: [[6, 5, "x"]] }), null, "stone blocks bullet sight");
  assert.equal(visibleEnemyBulletSnapshot("right", [8, 5], { terrain: [[6, 5, "m"]] }), null, "dirt blocks bullet sight");
  assert.equal(visibleEnemyBulletSnapshot("right", [8, 5], { terrain: [[6, 5, "o"]] }), null, "grass blocks bullet sight");
  assert.equal(visibleEnemyBulletSnapshot("right", [8, 7], { terrain: [[6, 5, "x"]] }), null, "off-axis sight checks every crossed cell");
}

function visibleEnemyBulletSnapshot(direction, bulletPosition, options = {}) {
  const map = openMap(11, 11);
  for (const [x, y, terrain] of options.terrain || []) {
    map[x][y] = terrain;
  }
  const sim = new AgenTankSimulator({
    map,
    tanks: [
      { id: "a", position: [5, 5], direction, skillType: "teleport" },
      { id: "b", position: [9, 9], direction: "left", skillType: "overload" }
    ]
  });
  sim.bullets.push({ objectId: "enemy-shot", ownerIndex: 1, ownerObjectId: "b", position: bulletPosition, direction: "left", crashed: false });
  const bullet = sim.snapshotFor(0).enemy.bullet;
  return bullet ? bullet.position : null;
}

function testSeededStarSpawnIsDeterministic() {
  const create = () => new AgenTankSimulator({
    seed: 123,
    map: openMap(7, 5),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [5, 3], direction: "left", skillType: "overload" }
    ]
  });
  const a = create();
  const b = create();
  a.step([null, null]);
  b.step([null, null]);
  assert.deepEqual(a.star, b.star);
}

function testDefaultStarCollectionDoesNotEndMatch() {
  let spawnCount = 0;
  const sim = new AgenTankSimulator({
    seed: 42,
    star: [2, 1],
    map: openMap(7, 5),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [5, 3], direction: "left", skillType: "overload" }
    ],
    starProvider() {
      spawnCount += 1;
      return [3, 1];
    }
  });
  const events = sim.step([{ type: "go" }, null]);
  assert.equal(sim.result, null);
  assert.equal(spawnCount, 1);
  assert.equal(events.some((event) => event.type === "star" && event.action === "collected"), true);
  assert.deepEqual(sim.star, [3, 1]);
}

function testConfiguredWinningStarDoesNotSpawnReplacement() {
  const sim = new AgenTankSimulator({
    seed: 42,
    starLimit: 1,
    star: [2, 1],
    map: openMap(7, 5),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [5, 3], direction: "left", skillType: "overload" }
    ]
  });
  const events = sim.step([{ type: "go" }, null]);
  assert.equal(sim.result.reason, "star");
  assert.equal(events.filter((event) => event.type === "star" && event.action === "created").length, 1);
  assert.equal(events.some((event) => event.type === "star" && event.action === "collected"), true);
  assert.equal(sim.star, null);
  assert.deepEqual(sim.toReplayData().replayData.map.initialStar, [2, 1]);
}

function testDoubleKillTieBreaksByStarsThenRuntime() {
  const sim = new AgenTankSimulator({
    map: openMap(8, 5),
    tanks: [
      { id: "a", position: [1, 2], direction: "right", skillType: "overload", stars: 1 },
      { id: "b", position: [6, 2], direction: "left", skillType: "overload", stars: 2 }
    ]
  });
  sim.bullets.push(
    { objectId: "ba", ownerIndex: 0, ownerObjectId: "a", position: [4, 2], direction: "right", crashed: false },
    { objectId: "bb", ownerIndex: 1, ownerObjectId: "b", position: [3, 2], direction: "left", crashed: false }
  );
  sim.step([null, null]);
  assert.equal(sim.players[0].crashed, true);
  assert.equal(sim.players[1].crashed, true);
  assert.equal(sim.result.winner, 1);
}

function testDoubleKillTieBreaksByRuntimeWhenStarsTie() {
  const sim = new AgenTankSimulator({
    map: openMap(8, 5),
    tanks: [
      { id: "a", position: [1, 2], direction: "right", skillType: "overload", stars: 2 },
      { id: "b", position: [6, 2], direction: "left", skillType: "overload", stars: 2 }
    ]
  });
  sim.players[0].runTimeMs = 3;
  sim.players[1].runTimeMs = 7;
  sim.bullets.push(
    { objectId: "ba", ownerIndex: 0, ownerObjectId: "a", position: [4, 2], direction: "right", crashed: false },
    { objectId: "bb", ownerIndex: 1, ownerObjectId: "b", position: [3, 2], direction: "left", crashed: false }
  );
  sim.step([null, null]);
  assert.equal(sim.result.winner, 0);
}

function testCrashResultIsNotOverriddenByStarLimit() {
  const sim = new AgenTankSimulator({
    starLimit: 1,
    map: openMap(8, 5),
    tanks: [
      { id: "a", position: [1, 2], direction: "right", skillType: "overload", stars: 1 },
      { id: "b", position: [6, 2], direction: "left", skillType: "overload", stars: 0 }
    ]
  });
  sim.bullets.push({ objectId: "bb", ownerIndex: 1, ownerObjectId: "b", position: [3, 2], direction: "left", crashed: false });
  sim.step([null, null]);
  assert.equal(sim.players[0].crashed, true);
  assert.deepEqual(sim.result, { winner: 1, reason: "crashed" });
}

function testStarProviderSeesCurrentPlayerStatus() {
  const seen = [];
  const sim = new AgenTankSimulator({
    map: openMap(10, 7),
    tanks: [
      { id: "a", position: [1, 1], direction: "right", skillType: "teleport" },
      { id: "b", position: [8, 5], direction: "left", skillType: "overload" }
    ],
    starProvider({ frame, players }) {
      seen.push({ frame, fireLocked: players[0].status.fireLocked });
      return null;
    }
  });
  sim.step([{ type: "teleport", x: 5, y: 5 }, null]);
  sim.step([null, null]);
  sim.step([null, null]);
  sim.step([null, null]);
  assert.deepEqual(seen.map((item) => item.fireLocked), [true, true, true, false]);
}

function testRawMapParsingKeepsStartsAndTerrain() {
  const parsed = parseRawMap([
    "xxxxxx",
    "xa.omx",
    "x...Ax",
    "xxxxxx"
  ].join("|"));
  assert.deepEqual(parsed.tanks[0], { position: [1, 1], direction: "up" });
  assert.deepEqual(parsed.tanks[1], { position: [4, 2], direction: "up" });
  assert.equal(parsed.map[3][1], "o");
  assert.equal(parsed.map[4][1], "m");
  assert.deepEqual(mapFromRows(["xxx", "x.x", "xxx"])[1][1], ".");
}

function testRandomScenarioGenerationIsSeeded() {
  const first = createRandomScenario({ width: 11, height: 9, seed: 42 });
  const second = createRandomScenario({ width: 11, height: 9, seed: 42 });
  assert.equal(serializeRawMap(first.map, first.tanks), serializeRawMap(second.map, second.tanks));
  assert.deepEqual(first.star, second.star);
  assert.equal(first.tanks.length, 2);
  assert.equal(first.map.length, 11);
  assert.equal(first.map[0].length, 9);
  assert.notDeepEqual(first.tanks[0].position, first.tanks[1].position);
}

function testSimulatorRejectsMapsWithMissingTankStart() {
  assert.throws(
    () => new AgenTankSimulator({ map: "xxx|xAx|xxx" }),
    /Simulator requires two tank start states/
  );
}

function testSimulateLocalPassesConfiguredBotTimeout() {
  const dir = mkdtempSync(join(tmpdir(), "agentank-sim-"));
  try {
    const slowBot = join(dir, "slow-bot.js");
    const idleBot = join(dir, "idle-bot.js");
    const replayFile = join(dir, "replay.json");
    writeFileSync(slowBot, `
      function onIdle(me) {
        const end = Date.now() + 25;
        while (Date.now() < end) {}
        me.go();
      }
    `);
    writeFileSync(idleBot, "function onIdle() {}");
    const baseArgs = [
      SIMULATE_LOCAL_CLI,
      "--bot-a", slowBot,
      "--bot-b", idleBot,
      "--map", "xxxxxx|xb..Ax|xxxxxx",
      "--max-frames", "1",
      "--out", replayFile
    ];
    const timedOut = spawnSync(process.execPath, [...baseArgs, "--bot-timeout-ms", "1"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8"
    });
    assert.equal(timedOut.status, 0);
    let replay = JSON.parse(readFileSync(replayFile, "utf8"));
    assert.equal(replay.replayData.replay.records[0].some((event) => event.type === "tank" && event.action === "go"), false);

    const completed = spawnSync(process.execPath, [...baseArgs, "--bot-timeout-ms", "100"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8"
    });
    assert.equal(completed.status, 0);
    replay = JSON.parse(readFileSync(replayFile, "utf8"));
    assert.equal(replay.replayData.replay.records[0].some((event) => event.type === "tank" && event.action === "go"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testSimulateLocalRandomMapMode() {
  const dir = mkdtempSync(join(tmpdir(), "agentank-random-sim-"));
  try {
    const bot = join(dir, "bot.js");
    const replayFile = join(dir, "nested", "replay.json");
    writeFileSync(bot, "function onIdle(me) { me.go(); }");
    const result = spawnSync(process.execPath, [
      SIMULATE_LOCAL_CLI,
      "--bot-a", bot,
      "--bot-b", bot,
      "--random-map",
      "--width", "11",
      "--height", "9",
      "--seed", "42",
      "--max-frames", "2",
      "--out", replayFile
    ], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8"
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /map=/);
    assert.match(result.stdout, /star=/);
    const replay = JSON.parse(readFileSync(replayFile, "utf8"));
    assert.equal(replay.replayData.replay.records.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testIsolatedBotRunnerBlocksHostFileAccess() {
  const dir = mkdtempSync(join(tmpdir(), "agentank-isolate-"));
  try {
    const evilBot = join(dir, "evil-bot.js");
    writeFileSync(evilBot, `
      function onIdle(me) {
        const proc = this.constructor.constructor("return process")();
        try {
          proc.getBuiltinModule("fs").readFileSync("/etc/passwd", "utf8");
          me.speak("fs:allowed");
        } catch (error) {
          me.speak("fs:" + error.code);
        }
        try {
          proc.getBuiltinModule("child_process").execFileSync("/bin/echo", ["owned"], { encoding: "utf8" });
          me.speak("child:allowed");
        } catch (error) {
          me.speak("child:" + error.code);
        }
      }
    `);
    const bot = await loadIsolatedBotFromFile(evilBot, { timeoutMs: 50 });
    try {
      const decision = await bot.decide({
        me: {
          tank: { id: "a", position: [1, 1], direction: "right" },
          stars: 0,
          bullet: null,
          skill: { type: "teleport" },
          status: {},
          effects: {}
        },
        enemy: {
          tank: { id: "b", position: [2, 1], direction: "left" },
          stars: 0,
          bullet: null,
          skill: null,
          status: {},
          effects: {}
        },
        game: { frames: 0, star: null, map: [] }
      });
      assert.deepEqual(decision.logs.map((log) => log.data), ["fs:ERR_ACCESS_DENIED", "child:ERR_ACCESS_DENIED"]);
    } finally {
      bot.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testIsolatedBotRunnerClosesWorkerAfterInitError() {
  const runner = new IsolatedBotRunner({ timeoutMs: 50, hostTimeoutMs: 500 });
  await assert.rejects(
    () => runner.init("function onIdle( {"),
    /Unexpected|Invalid|missing|Unexpected end/i
  );
  await waitForChildExit(runner.child);
  assert.equal(runner.closed, true);
}

async function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// ---------------------------------------------------------------------------
// Multiplayer / team-mode coverage
// ---------------------------------------------------------------------------

function ffaSim(extra = {}) {
  return new AgenTankSimulator({
    map: openMap(15, 9),
    tanks: [
      { id: "a", position: [2, 4], direction: "right", skillType: "freeze" },
      { id: "b", position: [7, 4], direction: "left", skillType: "overload" },
      { id: "c", position: [12, 4], direction: "left", skillType: "teleport" }
    ],
    ...extra
  });
}

function testFfaSnapshotShape() {
  const sim = ffaSim();
  const snap = sim.snapshotFor(0);
  assert.equal(snap.game.myIndex, 0);
  assert.equal(snap.game.alivePlayers, 3);
  assert.equal(snap.game.team, null);
  assert.deepEqual(snap.game.allies, []);
  assert.equal(snap.game.enemies.length, 2, "two visible enemies in 3-way FFA");
  assert.equal(snap.game.players.length, 3, "players array spans the whole field");
  assert.equal(Array.isArray(snap.game.visibleBullets), true);
  assert.equal(snap.me.index, 0);
  assert.equal(snap.me.team, null);
  assert.equal(snap.me.name, "a");
}

function testPrimaryOpponentThreatScoreSelection() {
  // b at dist 5 (score 5); c at dist 8 but holds a bullet (8-5=3) -> c is the higher threat.
  const sim = new AgenTankSimulator({
    map: openMap(15, 9),
    tanks: [
      { id: "a", position: [2, 4], direction: "right", skillType: "freeze" },
      { id: "b", position: [7, 4], direction: "left", skillType: "overload" },
      { id: "c", position: [10, 4], direction: "left", skillType: "teleport" }
    ]
  });
  sim.bullets.push({ objectId: "cs", ownerIndex: 2, ownerObjectId: "c", position: [9, 4], direction: "left", crashed: false });
  assert.equal(sim.primaryOpponentIndexFor(sim.players[0]), 2, "bullet holder is prioritised");

  // Without the bullet, the nearer enemy (b) wins.
  const plain = ffaSim();
  assert.equal(plain.primaryOpponentIndexFor(plain.players[0]), 1, "nearest enemy by default");
}

function testSingleTargetSkillHitsPrimaryOnly() {
  // a uses freeze; primary should be the nearer b, not c.
  const sim = ffaSim();
  sim.step([{ type: "freeze" }, null, null]);
  assert.equal(sim.snapshotFor(1).me.status.frozen, true, "primary opponent b is frozen");
  assert.equal(sim.snapshotFor(2).me.status.frozen, false, "non-primary c is untouched");
}

function testTeleportFireLockTargetsPrimaryOnly() {
  // Teleport within 4 of the primary locks fire; landing far from primary does not.
  const near = new AgenTankSimulator({
    map: openMap(20, 9),
    tanks: [
      { id: "a", position: [1, 4], direction: "right", skillType: "teleport" },
      { id: "b", position: [10, 4], direction: "left", skillType: "overload" },
      { id: "c", position: [18, 4], direction: "left", skillType: "overload" }
    ]
  });
  near.step([{ type: "teleport", x: 7, y: 4 }, null, null]); // primary b is at [10,4], dist 3
  assert.equal(near.snapshotFor(0).me.status.fireLocked, true);

  const far = new AgenTankSimulator({
    map: openMap(20, 9),
    tanks: [
      { id: "a", position: [1, 4], direction: "right", skillType: "teleport" },
      { id: "b", position: [16, 4], direction: "left", skillType: "overload" },
      { id: "c", position: [18, 4], direction: "left", skillType: "overload" }
    ]
  });
  // Primary is the nearest enemy b at [16,4]; teleport to [3,4] is far from it -> no lock.
  far.step([{ type: "teleport", x: 3, y: 4 }, null, null]);
  assert.equal(far.snapshotFor(0).me.status.fireLocked, false);
}

function teamsSim(extra = {}) {
  // 2v2: teams [0,0,1,1]
  return new AgenTankSimulator({
    map: openMap(15, 9),
    tanks: [
      { id: "a", position: [2, 4], direction: "right", skillType: "overload" },
      { id: "b", position: [3, 4], direction: "right", skillType: "overload" },
      { id: "c", position: [11, 4], direction: "left", skillType: "overload" },
      { id: "d", position: [12, 4], direction: "left", skillType: "overload" }
    ],
    teams: [0, 0, 1, 1],
    ...extra
  });
}

function testTeammatesCannotShareCell() {
  // a at [2,4] tries to move right into teammate b at [3,4]; blocked, neither crashes.
  const sim = teamsSim();
  sim.step([{ type: "go" }, null, null, null]);
  assert.deepEqual(sim.players[0].position, [2, 4], "blocked by teammate");
  assert.equal(sim.players[0].crashed, false);
  assert.equal(sim.players[1].crashed, false);
  assert.equal(sim.result, null);
}

function testTeammateBulletsPassThrough() {
  // a fires right; teammate b sits directly in the path and must NOT be hit. The bullet keeps going.
  const sim = new AgenTankSimulator({
    map: openMap(15, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload" },
      { id: "b", position: [4, 2], direction: "right", skillType: "shield" },
      { id: "c", position: [10, 2], direction: "left", skillType: "overload" },
      { id: "d", position: [11, 2], direction: "left", skillType: "overload" }
    ],
    teams: [0, 0, 1, 1]
  });
  // b raises shield; an allied bullet must neither break it nor crash b.
  sim.step([null, { type: "shield" }, null, null]);
  sim.step([{ type: "fire" }, null, null, null]);
  sim.step([null, null, null, null]);
  assert.equal(sim.players[1].crashed, false, "teammate not hit");
  assert.equal(sim.snapshotFor(1).me.status.shielded, true, "ally shield not consumed");
}

function testFfaTanksAreMutualEnemies() {
  // a shoots b; in FFA any other tank is a valid target.
  const sim = new AgenTankSimulator({
    map: openMap(12, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload" },
      { id: "b", position: [5, 2], direction: "left", skillType: "overload" },
      { id: "c", position: [9, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.step([{ type: "fire" }, null, null]);
  sim.step([null, null, null]);
  assert.equal(sim.players[1].crashed, true, "FFA bullet crashes another tank");
}

function testFfaEndsWhenOneSurvivorRemains() {
  // Pre-crash c; then a kills b -> one survivor -> match ends with ranking + eliminations.
  const sim = new AgenTankSimulator({
    map: openMap(12, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload" },
      { id: "b", position: [5, 2], direction: "left", skillType: "overload" },
      { id: "c", position: [9, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.players[2].crashed = true; // c already out
  sim.step([{ type: "fire" }, null, null]);
  sim.step([null, null, null]);
  assert.equal(sim.players[1].crashed, true);
  assert.equal(sim.result.reason, "crashed");
  assert.equal(sim.result.winner, 0, "lone survivor wins");
  assert.equal(Array.isArray(sim.result.ranking), true);
  assert.equal(sim.result.ranking[0], 0);
  assert.equal(Array.isArray(sim.result.eliminations), true);
}

function testTeamsEndWhenOneTeamWiped() {
  // Team 1 (c,d) is pre-crashed except d; a kills d -> team 0 is the only team alive -> end.
  const sim = new AgenTankSimulator({
    map: openMap(14, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload" },
      { id: "b", position: [3, 2], direction: "right", skillType: "overload" },
      { id: "c", position: [9, 2], direction: "left", skillType: "overload" },
      { id: "d", position: [6, 2], direction: "left", skillType: "overload" }
    ],
    teams: [0, 0, 1, 1]
  });
  sim.players[2].crashed = true; // c out, d at [6,2] remains
  sim.step([{ type: "fire" }, null, null, null]);
  sim.step([null, null, null, null]);
  assert.equal(sim.players[3].crashed, true);
  assert.equal(sim.result.reason, "crashed");
  // winner is from team 0 (a or b), both alive
  assert.equal([0, 1].includes(sim.result.winner), true);
}

function testFfaFrameLimitRankingByStars() {
  const sim = new AgenTankSimulator({
    map: openMap(12, 5),
    maxFrames: 1,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload", stars: 1 },
      { id: "b", position: [5, 2], direction: "left", skillType: "overload", stars: 3 },
      { id: "c", position: [9, 2], direction: "left", skillType: "overload", stars: 2 }
    ]
  });
  sim.step([null, null, null]); // hits frame limit
  sim.finishByScore();
  assert.equal(sim.result.reason, "frameLimit");
  assert.deepEqual(sim.result.ranking, [1, 2, 0], "ranked by stars descending");
  assert.equal(sim.result.winner, 1);
}

function testTeamsRankingByTotalStars() {
  // Team 0 total = 1+1 = 2; team 1 total = 3+0 = 3 -> team 1 ranks first.
  const sim = new AgenTankSimulator({
    map: openMap(15, 5),
    maxFrames: 1,
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload", stars: 1 },
      { id: "b", position: [3, 2], direction: "right", skillType: "overload", stars: 1 },
      { id: "c", position: [11, 2], direction: "left", skillType: "overload", stars: 3 },
      { id: "d", position: [12, 2], direction: "left", skillType: "overload", stars: 0 }
    ],
    teams: [0, 0, 1, 1]
  });
  sim.step([null, null, null, null]);
  sim.finishByScore();
  assert.equal(sim.result.reason, "frameLimit");
  // team 1 first (c before d by stars), then team 0 (a/b tie by stars -> index order)
  assert.deepEqual(sim.result.ranking, [2, 3, 0, 1]);
  assert.equal(sim.result.winner, 2);
}

function testEliminationsRecordCauseAndKiller() {
  const sim = new AgenTankSimulator({
    map: openMap(12, 5),
    tanks: [
      { id: "a", position: [2, 2], direction: "right", skillType: "overload" },
      { id: "b", position: [5, 2], direction: "left", skillType: "overload" },
      { id: "c", position: [9, 2], direction: "left", skillType: "overload" }
    ]
  });
  sim.players[2].crashed = true;
  sim.step([{ type: "fire" }, null, null]);
  sim.step([null, null, null]);
  const bulletKill = sim.result.eliminations.find((entry) => entry.reason === "bullet");
  assert.equal(bulletKill.index, 1, "victim recorded");
  assert.equal(bulletKill.by, 0, "killer recorded");
  assert.equal(typeof bulletKill.frame, "number");
}

async function testTeamChatDeliversNextFrameToTeammatesOnly() {
  const sim = teamsSim();
  // a (team 0) broadcasts; b (team 0) should read it next frame, c/d (team 1) never.
  const senderDecision = { action: null, logs: [], runtimeMs: 0, teamInfo: [{ type: "target", content: "focus", location: [9, 4] }] };
  const idle = { action: null, logs: [], runtimeMs: 0, teamInfo: [] };
  // Same-frame send: inbox not yet visible.
  assert.deepEqual(sim.snapshotFor(1).game.teamInfo, []);
  sim.step([null, null, null, null], [senderDecision, idle, idle, idle]);
  // Next frame: teammate b sees it, enemy c does not.
  const allyInbox = sim.snapshotFor(1).game.teamInfo;
  assert.equal(allyInbox.length, 1, "teammate receives one message next frame");
  assert.equal(allyInbox[0].type, "target");
  assert.equal(allyInbox[0].from, 0);
  assert.deepEqual(allyInbox[0].location, [9, 4]);
  assert.deepEqual(sim.snapshotFor(2).game.teamInfo, [], "enemy team gets nothing");
}

async function testTeamChatConstraintsDropExtraOversizeAndInvalid() {
  const sim = teamsSim();
  const idle = { action: null, logs: [], runtimeMs: 0, teamInfo: [] };
  // a: two messages (only first kept). b: oversize (>1KB) dropped. c is enemy team anyway.
  const multi = { action: null, logs: [], runtimeMs: 0, teamInfo: [
    { type: "help", content: "first" },
    { type: "warn", content: "second" }
  ] };
  const oversize = { action: null, logs: [], runtimeMs: 0, teamInfo: [{ type: "info", content: "x".repeat(2000) }] };
  sim.step([null, null, null, null], [multi, oversize, idle, idle]);
  const inbox = sim.snapshotFor(0).game.teamInfo; // team 0 reads a + b sends
  assert.equal(inbox.length, 1, "only a's first message survives");
  assert.equal(inbox[0].content, "first");

  // invalid type dropped
  const sim2 = teamsSim();
  const bad = { action: null, logs: [], runtimeMs: 0, teamInfo: [{ type: "bogus", content: "nope" }] };
  sim2.step([null, null, null, null], [bad, idle, idle, idle]);
  assert.deepEqual(sim2.snapshotFor(1).game.teamInfo, [], "invalid type rejected");
}

async function testIsolatedRunnerCarriesTeamInfo() {
  const dir = mkdtempSync(join(tmpdir(), "agentank-team-"));
  try {
    const botFile = join(dir, "chatter.js");
    writeFileSync(botFile, `
      function onIdle(me) {
        me.sendTeamInfo("target", "focus", [3, 3]);
        me.go();
      }
    `);
    const bot = await loadIsolatedBotFromFile(botFile, { timeoutMs: 50 });
    try {
      const decision = await bot.decide({
        me: { index: 0, team: "ally", name: "a", tank: { id: "a", position: [1, 1], direction: "right" }, stars: 0, bullet: null, skill: null, status: {}, effects: {} },
        enemy: { tank: null, stars: 0, bullet: null, skill: null, status: {}, effects: {} },
        game: { frames: 0, star: null, map: [], teamInfo: [] }
      });
      assert.equal(Array.isArray(decision.teamInfo), true);
      assert.equal(decision.teamInfo.length, 1, "team message survives IPC round trip");
      assert.equal(decision.teamInfo[0].type, "target");
      assert.deepEqual(decision.teamInfo[0].location, [3, 3]);
    } finally {
      bot.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testRunAcceptsArrayAndVariadicBots() {
  const code = "function onIdle(me) { me.go(); }";
  const variadic = new AgenTankSimulator({ map: openMap(10, 5), maxFrames: 2, tanks: [
    { id: "a", position: [2, 2], direction: "right" },
    { id: "b", position: [7, 2], direction: "left" }
  ] });
  variadic.run(loadBotFromCode(code), loadBotFromCode(code));
  assert.equal(variadic.result != null, true, "run(a, b) finishes");

  const arrayForm = new AgenTankSimulator({ map: openMap(14, 5), maxFrames: 2, tanks: [
    { id: "a", position: [2, 2], direction: "right" },
    { id: "b", position: [7, 2], direction: "left" },
    { id: "c", position: [11, 2], direction: "left" }
  ] });
  arrayForm.run([loadBotFromCode(code), loadBotFromCode(code), loadBotFromCode(code)]);
  assert.equal(arrayForm.result != null, true, "run([b0, b1, b2]) finishes");
  assert.equal(arrayForm.result.ranking.length, 3, "3-player ranking present");
}

function testCloneIsDeterministicForMultiplayer() {
  const sim = ffaSim();
  sim.step([{ type: "go" }, { type: "go" }, null]);
  const copy = sim.clone();
  assert.equal(copy.mode, sim.mode);
  assert.equal(copy.multiplayer, true);
  assert.equal(copy.players.length, 3);
  assert.notEqual(copy.players, sim.players);
  // mutating the clone must not bleed into the original
  copy.players[0].position[0] = 99;
  assert.notEqual(sim.players[0].position[0], 99);
  copy.eliminations.push({ index: 9 });
  assert.notEqual(sim.eliminations.length, copy.eliminations.length);
}

function testRawMapParsesNumericExtraTanks() {
  const parsed = parseRawMap([
    "xxxxxxx",
    "xa...Ax",
    "x2...3x",
    "xxxxxxx"
  ].join("|"));
  assert.deepEqual(parsed.tanks[0].position, [1, 1]);
  assert.deepEqual(parsed.tanks[1].position, [5, 1]);
  assert.deepEqual(parsed.tanks[2], { position: [1, 2], direction: "up" });
  assert.deepEqual(parsed.tanks[3], { position: [5, 2], direction: "up" });
  // round-trip via serializeRawMap keeps positions for N>2
  const round = serializeRawMap(parsed.map, parsed.tanks);
  const reparsed = parseRawMap(round);
  assert.deepEqual(reparsed.tanks.map((tank) => tank.position), parsed.tanks.map((tank) => tank.position));
}





