import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { turnDirection } from "./constants.js";

export async function loadBotFromFile(path, options = {}) {
  const code = await readFile(path, "utf8");
  return loadBotFromCode(code, options);
}

export function loadBotFromCode(code, options = {}) {
  const logs = [];
  const sandbox = {
    print: (...args) => logs.push({ type: "print", data: args.join(" ") }),
    speak: (text) => logs.push({ type: "speak", data: String(text ?? "") })
  };
  vm.createContext(sandbox, { microtaskMode: "afterEvaluate" });
  vm.runInContext(`${code}
this.__agentankOnIdle = typeof onIdle === "function" ? onIdle : null;
`, sandbox, { timeout: options.loadTimeoutMs || 1000 });
  if (typeof sandbox.__agentankOnIdle !== "function") {
    throw new Error("Bot code must define function onIdle(me, enemy, game)");
  }
  return new BotRunner(sandbox, logs, options);
}

export class BotRunner {
  constructor(sandbox, logs, options = {}) {
    this.sandbox = sandbox;
    this.logs = logs;
    this.timeoutMs = Math.max(1, Math.floor(Number(options.timeoutMs) || 20));
    this.queue = [];
    this.turnScript = new vm.Script(`
{
  globalThis.__agentankTurn = { status: "pending" };
  try {
    const result = globalThis.__agentankOnIdle(globalThis.__agentankFrame.me, globalThis.__agentankFrame.enemy, globalThis.__agentankFrame.game);
    if (result && typeof result.then === "function") {
      result.then(
        () => { globalThis.__agentankTurn = { status: "fulfilled" }; },
        (error) => { globalThis.__agentankTurn = { status: "rejected", error }; }
      );
    } else {
      globalThis.__agentankTurn = { status: "fulfilled" };
    }
  } catch (error) {
    globalThis.__agentankTurn = { status: "rejected", error };
  }
}
`);
  }

  decide(context) {
    if (this.queue.length > 0) {
      // 上游 queue guard：转向被压制时清空队列；多坦克侧补 teamInfo 空数组保持决策结构一致
      const queued = this.shiftQueuedDecision(context.me);
      if (queued) return queued;
    }
    this.logs.length = 0;
    const actions = [];
    const teamInfo = [];
    const me = createAgentProxy(context.me, actions, this.logs, teamInfo);
    const enemy = context.enemy;
    const game = context.game;
    const started = process.hrtime.bigint();
    try {
      this.sandbox.__agentankFrame = { me, enemy, game };
      this.turnScript.runInContext(this.sandbox, { timeout: this.timeoutMs });
    } catch (error) {
      this.sandbox.__agentankFrame = null;
      this.sandbox.__agentankTurn = null;
      return this.errorDecision(started, error, teamInfo);
    }
    const turn = this.sandbox.__agentankTurn;
    this.sandbox.__agentankFrame = null;
    this.sandbox.__agentankTurn = null;
    if (turn?.status === "rejected") return this.errorDecision(started, turn.error, teamInfo);
    if (turn?.status === "pending") return this.timeoutDecision(started, undefined, teamInfo);
    return this.finishDecision(started, actions, context.me, teamInfo);
  }

  finishDecision(started, actions, snapshot = {}, teamInfo = []) {
    const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (runtimeMs > this.timeoutMs) {
      return {
        action: { type: "timeout", runtimeMs },
        logs: this.logs.slice(),
        runtimeMs,
        teamInfo: teamInfo.slice()
      };
    }
    const boostActive = isBoostActive(snapshot);
    if (boostActive && actions[0]?.type === "turn" && actions[1]?.type === "go") {
      const [, , ...queued] = actions;
      const action = { type: "turnGo", side: actions[0].side };
      this.queueActions(queued, queueGuardForAction(action, snapshot));
      const reason = actions[0].reason || actions[1].reason;
      if (reason) action.reason = reason;
      return {
        action,
        logs: this.logs.slice(),
        runtimeMs,
        teamInfo: teamInfo.slice()
      };
    }
    if (boostActive && actions[0]?.type === "turn" && actions[1]?.type === "fire") {
      const [, , ...queued] = actions;
      const action = { type: "turnFire", side: actions[0].side };
      this.queueActions(queued, queueGuardForAction(action, snapshot));
      const reason = actions[0].reason || actions[1].reason;
      if (reason) action.reason = reason;
      return {
        action,
        logs: this.logs.slice(),
        runtimeMs,
        teamInfo: teamInfo.slice()
      };
    }
    const [action, ...queued] = actions;
    this.queueActions(queued, queueGuardForAction(action, snapshot));
    return {
      action: action || null,
      logs: this.logs.slice(),
      runtimeMs,
      teamInfo: teamInfo.slice()
    };
  }

  shiftQueuedDecision(snapshot = {}) {
    const entry = this.queue[0];
    if (!entry) return null;
    if (!queueGuardMatches(entry.guard, snapshot)) {
      this.queue.length = 0;
      return null;
    }
    this.queue.shift();
    return { action: entry.action, logs: [], runtimeMs: 0, queued: true, teamInfo: [] };
  }

  queueActions(actions, guard) {
    for (const action of actions) this.queue.push({ action, guard });
  }

  timeoutDecision(started, error, teamInfo = []) {
    const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      action: { type: "timeout", runtimeMs },
      logs: this.logs.slice(),
      runtimeMs,
      teamInfo: teamInfo.slice(),
      error
    };
  }

  errorDecision(started, error, teamInfo = []) {
    if (isVmTimeout(error)) return this.timeoutDecision(started, error, teamInfo);
    const runtimeMs = Number(process.hrtime.bigint() - started) / 1e6;
    return {
      action: { type: "error", message: error?.message || String(error) },
      logs: this.logs.slice(),
      runtimeMs,
      teamInfo: teamInfo.slice(),
      error
    };
  }
}

function isBoostActive(snapshot = {}) {
  if (!snapshot.status?.boosted) return false;
  const remainingFrames = snapshot.skill?.activeRemainingFrames ?? snapshot.effects?.self?.remainingFrames;
  return remainingFrames == null || remainingFrames > 0;
}

function queueGuardForAction(action, snapshot = {}) {
  if ((action?.type === "turn" || action?.type === "turnGo" || action?.type === "turnFire") && snapshot.tank?.direction) {
    return {
      direction: turnDirection(snapshot.tank.direction, action.side === "left" ? "left" : "right")
    };
  }
  return null;
}

function queueGuardMatches(guard, snapshot = {}) {
  if (!guard) return true;
  if (guard.direction && snapshot.tank?.direction !== guard.direction) return false;
  return true;
}

function createAgentProxy(snapshot, actions, logs, teamInfo = []) {
  const reasonOf = () => agent.__actionReason || undefined;
  const withReason = (action) => {
    const reason = reasonOf();
    if (reason) action.reason = reason;
    return action;
  };
  const agent = {
    __debugActionReasonSink: true,
    index: snapshot.index,
    team: snapshot.team,
    name: snapshot.name,
    tank: snapshot.tank,
    stars: snapshot.stars,
    bullet: snapshot.bullet,
    skill: snapshot.skill,
    status: snapshot.status,
    effects: snapshot.effects,
    go(count = 1) {
      const steps = Math.max(1, Math.floor(Number(count) || 1));
      for (let i = 0; i < steps; i += 1) actions.push(withReason({ type: "go" }));
    },
    turn(side) {
      actions.push(withReason({ type: "turn", side: side === "left" ? "left" : "right" }));
    },
    fire() {
      actions.push({ type: "fire", reason: agent.__actionReason || undefined });
    },
    overload() {
      actions.push(withReason({ type: "overload" }));
    },
    shield() {
      actions.push({ type: "shield" });
    },
    stun() {
      actions.push({ type: "stun" });
    },
    poison() {
      actions.push({ type: "poison" });
    },
    boost() {
      actions.push(withReason({ type: "boost" }));
    },
    cloak() {
      actions.push({ type: "cloak" });
    },
    teleport(x, y) {
      actions.push({ type: "teleport", x: Number(x), y: Number(y), reason: agent.__teleportReason || undefined });
    },
    freeze() {
      actions.push({ type: "freeze" });
    },
    throwBomb() {
      actions.push(withReason({ type: "throwBomb" }));
    },
    speak(text) {
      logs.push({ type: "speak", data: String(text ?? "") });
    },
    print(...args) {
      logs.push({ type: "print", data: args.join(" ") });
    },
    sendTeamInfo(type, content, location) {
      teamInfo.push({
        type: String(type ?? ""),
        content,
        location: Array.isArray(location) ? location.slice() : undefined
      });
    }
  };
  for (const skill of ["overload", "cloak", "teleport", "freeze", "shield", "stun", "poison", "boost"]) {
    if (snapshot.skill?.type !== skill) delete agent[skill];
  }
  return agent;
}

function isVmTimeout(error) {
  return error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" || /Script execution timed out/.test(error?.message || "");
}
