import { randomUUID } from "node:crypto";
const memoryId = "dsh-interval-memory:";
const pruneId = "dsh-window-pruned:";
function ownership(session) {
  const owners = /* @__PURE__ */ new Map();
  let turn = 0;
  for (const event of session.ownEvents()) {
    if (event.type === "turn/start") turn = event.data.turn;
    const message = session.deriveEventMessage(event);
    if (message === null) continue;
    if (["system", "developer"].includes(message.role)) {
      owners.set(event.seq, -1);
    } else if (message.id?.startsWith(pruneId)) {
      owners.set(event.seq, 0);
    } else if (event.surfaceOp?.op === "replace") {
      const parents = new Set((event.sourceEventSeqs ?? []).map((s) => owners.get(s)).filter((t) => t !== void 0));
      if (parents.size !== 1 || parents.has(0)) throw new Error("Token-saving history contains a cross-round replacement");
      owners.set(event.seq, [...parents][0]);
    } else {
      owners.set(event.seq, turn);
    }
  }
  return owners;
}
function replacePrefix(session, meter, state) {
  const owners = ownership(session);
  const nodes = session.surface.nodes;
  const cutoff = state.evicted_through;
  const blocks = [];
  let block = [], retainedStarted = false;
  const first = nodes.findIndex((seq) => owners.get(seq) !== -1);
  const conversational = first < 0 ? [] : nodes.slice(first);
  const flush = () => { if (block.length) { blocks.push(block); block = []; } };
  for (const seq of conversational) {
    const owner = owners.get(seq);
    if (owner === void 0) throw new Error("Unowned surface message");
    // DSH may append a new system prompt when Evolith is enabled mid-session.
    // Preserve it in place and prune expired conversational blocks on each side.
    if (owner === -1) { flush(); continue; }
    if (owner >= 0 && owner <= cutoff) {
      if (retainedStarted) throw new Error("Expired rounds are not a contiguous surface prefix");
      block.push(seq);
    } else { flush(); retainedStarted = true; }
  }
  flush();
  const message = {
    id: pruneId + randomUUID(),
    role: "user",
    source: { kind: "user" },
    content: [{ type: "text", text: "Original conversation rounds through " + cutoff + " have left the retained conversation window." }]
  };
  const prices = new Map(meter.measure(session).nodes.map((n) => [n.seq, n.heuristicTokens]));
  const plan=blocks.map(prefix=>{
    const shadowedTokenCount=prefix.reduce((n,seq)=>n+prices.get(seq),0);
    if(!Number.isFinite(shadowedTokenCount))throw new Error("Missing native token price");
    return {prefix,shadowedTokenCount};
  });
  for (const {prefix,shadowedTokenCount} of plan) {
    const shadowedRange = { start: prefix[0], end: prefix.at(-1) };
    session.append("compaction/prune", { shadowedRange, shadowedSeqs: [...prefix], shadowedTokenCount, reason: "token-saving-window" });
    session.append("user/message", { ...message, id: pruneId + randomUUID() }, {
      surfaceOp: { op: "replace", startSeq: shadowedRange.start, endSeq: shadowedRange.end },
      sourceEventSeqs: prefix
    });
  }
  const removed = new Set(blocks.flat());
  return { evicted_through: Math.max(0, cutoff), retained_turns: [...new Set(conversational.filter(seq => !removed.has(seq) && owners.get(seq) > 0).map(seq => owners.get(seq)))] };
}
function compactableGroups(session) {
  const owners = ownership(session);
  const groups = [];
  for (const seq of session.surface.nodes) {
    const owner = owners.get(seq);
    const message = session.deriveEventMessage(session.eventAt(seq));
    if (!owner || owner === -1) continue;
    if (message?.id?.startsWith(memoryId)) {
      groups.push({ turn: -1, nodes: [] });
      continue;
    }
    if (groups.at(-1)?.turn !== owner) groups.push({ turn: owner, nodes: [] });
    groups.at(-1).nodes.push(seq);
  }
  return groups;
}
function balancedPrefix(session, nodes) {
  let pending = 0;
  const cuts = [];
  for (let i = 0; i < nodes.length; i++) {
    const event = session.eventAt(nodes[i]);
    const content = session.deriveEventMessage(event)?.content ?? [];
    pending += content.filter((b) => b.type === "tool-call").length;
    pending -= content.filter((b) => b.type === "tool-result").length;
    if (pending < 0) throw new Error("Orphan native tool result");
    if (pending === 0 && i > 0) cuts.push(i + 1);
  }
  const cut = cuts.filter((n) => n < nodes.length).at(-1);
  return cut ? nodes.slice(0, cut) : [];
}
function constrainCompaction(engine, consent, onFallback = () => {}) {
  if (typeof engine?.compactRegion !== "function") return () => {
  };
  const original = engine.compactRegion;
  async function bounded(start, end, agent, signal) {
    let targetStart = start, targetEnd = end;
    try {
      if (await consent.enabled(String(agent.session.id))) {
        const session = agent.session, nodes = session.surface.nodes;
        const requested = new Set(nodes.slice(nodes.indexOf(start), nodes.indexOf(end) + 1));
        const regions = compactableGroups(session).map((g) => balancedPrefix(session, g.nodes.filter((seq) => requested.has(seq)))).filter((group) => group.length >= 2).sort((a, b) => b.length - a.length);
        if (!regions.length) throw new Error("Evolith 无可安全压缩的局部区域，交还 DSH 原生压缩。");
        targetStart = regions[0][0]; targetEnd = regions[0].at(-1);
      }
    } catch (e) {
      onFallback(String(agent.session.id), e);
    }
    // Native compaction errors belong to DSH; never invoke it twice.
    return original.call(this, targetStart, targetEnd, agent, signal);
  }
  engine.compactRegion = bounded;
  return () => {
    if (engine.compactRegion === bounded) engine.compactRegion = original;
  };
}
export {
  balancedPrefix,
  compactableGroups,
  constrainCompaction,
  ownership,
  replacePrefix
};
