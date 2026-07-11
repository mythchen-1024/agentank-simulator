import { loadBotFromCode } from "./bot-runner.js";

let bot = null;

process.on("message", (message) => {
  handleMessage(message).catch((error) => {
    process.send?.({ id: message?.id, error: serializeError(error) });
  });
});

async function handleMessage(message) {
  if (message.type === "init") {
    bot = loadBotFromCode(message.code, message.options || {});
    process.send?.({ id: message.id, result: { ok: true } });
    return;
  }
  if (message.type === "decide") {
    if (!bot) throw new Error("Bot worker is not initialized");
    process.send?.({ id: message.id, result: sanitizeDecision(await bot.decide(message.context)) });
    return;
  }
  throw new Error(`Unknown bot worker message type: ${message.type}`);
}

function sanitizeDecision(decision) {
  return {
    action: decision.action || null,
    logs: decision.logs || [],
    runtimeMs: Number(decision.runtimeMs || 0),
    queued: decision.queued || undefined,
    teamInfo: Array.isArray(decision.teamInfo) ? decision.teamInfo : [],
    error: decision.error ? serializeError(decision.error) : undefined
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    code: error?.code,
    message: error?.message || String(error)
  };
}
