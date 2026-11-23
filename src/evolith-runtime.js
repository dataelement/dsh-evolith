import { join, dirname } from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { EvolithConsent } from "./evolith-consent.js";
import { GroupConfigStore } from "./group-config.js";
import { isTrustedRequest, sendJson, readJson } from "./web-api.js";
import { sessionEvents } from "./session-events.js";
import { messageText } from "./episode.js";
import { replacePrefix, constrainCompaction } from "./evolith-window.js";
import { VerifiedMemoryStore, verifiedMemoryTool, VERIFIED_MEMORY_INSTRUCTION } from "./verified-memory.js";
function installEvolithBridge(ctx, config = {}, deps = {}) {
  const store = deps.store || new GroupConfigStore();
  const consent = deps.consent || new EvolithConsent(process.env.DSH_HOME ? join(process.env.DSH_HOME, "evolith-consent.json") : void 0);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const logs = [], pending = /* @__PURE__ */ new Map(), views = /* @__PURE__ */ new Map(), outbox = new Map(), active = /* @__PURE__ */ new Map();
  const outboxPath = deps.outboxPath ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, "evolith-pending.json") : undefined);
  const verificationStore = deps.verificationStore || new VerifiedMemoryStore(deps.verificationPath ?? (process.env.DSH_HOME ? join(process.env.DSH_HOME, "evolith-verified-memory.json") : undefined));
  verificationStore.ready.catch(error);
  const verificationTools = new Map();
  let agentService;
  async function syncVerificationTools(agent) {
    if (!agent?.session?.id) return;
    const id=String(agent.session.id);
    await ready;
    const enabled=await consent.enabled(id),current=verificationTools.get(id);
    if(current?.agent===agent&&enabled)return;
    if(current){current.dispose();verificationTools.delete(id);}
    if(!enabled)return;
    const tools=agent.ctx?.get?.('tools'),prompt=agent.ctx?.get?.('systemPrompt');
    if(!tools?.register||!prompt?.section)throw Error('当前DSH缺少会话工具或提示词服务，无法启用记忆验证工具');
    const unregister=tools.register(verifiedMemoryTool({agent,consent,store:verificationStore,owner:()=>consent.owner()}));
    let removeInstruction;
    try{removeInstruction=prompt.section({name:'evolith:verified-memory-policy',order:900,text:VERIFIED_MEMORY_INSTRUCTION})}catch(e){unregister();throw e}
    const dispose=()=>{unregister();removeInstruction();};
    verificationTools.set(id,{agent,dispose});
    agent.ctx.effect(()=>dispose);
  }
  let outboxWrites = Promise.resolve();
  let connection = { serverUrl: config.serverUrl || "http://192.168.106.20:28292", apiToken: "" };
  consent.owner = () => createHash("sha256").update(connection.serverUrl + "\0" + connection.apiToken).digest("hex");
  const ready = store.loadConfig().then(async (saved) => {
    connection = { serverUrl: saved.serverUrl || connection.serverUrl, apiToken: saved.apiToken || "" };
    if (outboxPath) {
      try {
        const data = JSON.parse(await readFile(outboxPath, "utf8"));
        if (data.owner === consent.owner()) {
          for (const [id, jobs] of data.queues || []) outbox.set(id, jobs);
        }
      } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
  });
  ready.catch(error);
  consent.ready.catch(error);
  ctx.inject(['agents'], scoped=>{
    if(!scoped.agents?.list)return;
    agentService=scoped.agents;
    scoped.on('agent/created',async({agent})=>{await syncVerificationTools(agent)},{global:true});
    scoped.on('agent/disposed',({agent})=>{const id=String(agent.session.id),current=verificationTools.get(id);if(current?.agent===agent){current.dispose();verificationTools.delete(id)}},{global:true});
    scoped.effect(()=>{for(const agent of agentService.list())syncVerificationTools(agent).catch(error);return()=>{for(const entry of verificationTools.values())entry.dispose();verificationTools.clear()}});
  });

  function persistOutbox() {
    if (!outboxPath) return Promise.resolve();
    const snapshot = JSON.stringify({version: 1, owner: consent.owner(), queues: [...outbox]});
    const op = outboxWrites.catch(() => {}).then(async () => {
      await mkdir(dirname(outboxPath), {recursive: true, mode: 0o700});
      const temporary = outboxPath + "." + randomUUID() + ".tmp";
      await writeFile(temporary, snapshot, {mode: 0o600});
      await rename(temporary, outboxPath);
    });
    outboxWrites = op;
    return op;
  }
  function error(e) {
    logs.push({ at: (/* @__PURE__ */ new Date()).toISOString(), message: String(e?.message || e).replaceAll(connection.apiToken || "\0", "[REDACTED]") });
    if (logs.length > 200) logs.shift();
  }
  async function request(path, body, id) {
    await ready;
    if (id && !await consent.enabled(id)) throw new Error("Evolith已关闭，未发送数据");
    if (!connection.apiToken.trim()) throw new Error("未填写 Evolith 记忆访问密钥。请前往「设置 → 记忆」，填写访问密钥并保存，再点击「检查连接」后重试。这不是聊天模型的 API 密钥。");
    const controller = new AbortController();
    if (id) {
      if (!active.has(id)) active.set(id, /* @__PURE__ */ new Set());
      active.get(id).add(controller);
    }
    try {
      const response = await fetchImpl(connection.serverUrl + "/v1/evolith/" + path, {
        method: body ? "POST" : "GET",
        headers: { authorization: "Bearer " + connection.apiToken, ...body ? { "content-type": "application/json" } : {} },
        ...body ? { body: JSON.stringify(body) } : {},
        signal: AbortSignal.any([AbortSignal.timeout(6e5), controller.signal])
      });
      if (response.status === 401) throw new Error("Evolith 记忆访问密钥无效或已过期。请前往「设置 → 记忆」，更新访问密钥并保存，再点击「检查连接」后重试。这不是聊天模型的 API 密钥。");
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "Memory HTTP " + response.status);
      return data;
    } finally {
      if (id) active.get(id)?.delete(controller);
    }
  }
  function history(session) {
    let turn = 0;
    const out = [];
    for (const e of sessionEvents(session)) {
      if (e.type === "turn/start") turn = e.data.turn;
      if (!["user/message", "assistant/message", "tool/result"].includes(e.type) || e.surfaceOp && e.surfaceOp !== "append" && e.surfaceOp.op !== "append") continue;
      const message = typeof session.deriveEventMessage === "function" ? session.deriveEventMessage(e) : e.data?.message || e.data;
      if (e.type === "user/message" && message?.source?.kind !== "user") continue;
      const mid = String(message?.id || "");
      if (mid.startsWith("dsh-interval-memory:") || mid.startsWith("dsh-window-pruned:")) continue;
      const text = messageText(message);
      if (text) out.push({ turn, role: e.type === "user/message" ? "user" : e.type === "tool/result" ? "tool" : "assistant", content: text });
    }
    return out;
  }
  ctx.inject(["compaction"], (scoped) => scoped.effect(() => constrainCompaction(scoped.compaction, consent)));
  function drain(id) {
    if (pending.has(id)) return pending.get(id);
    const work = (async () => {
      const queue = outbox.get(id) || [];
      while (queue.length) {
        if (!await consent.enabled(id)) { queue.length = 0; return; }
        const job = queue[0];
        await persistOutbox();
        await request(job.path, job.body, id);
        queue.shift();
        await persistOutbox();
      }
    })();
    pending.set(id, work);
    work.then(() => { pending.delete(id); if (outbox.get(id)?.length) drain(id); }, e => { error(e); pending.delete(id); });
    return work;
  }
  function enqueue(id, path, body) {
    if (!outbox.has(id)) outbox.set(id, []);
    outbox.get(id).push({path, body});
    drain(id);
  }
  async function afterPending(id) {
    // Observe any failed background delivery, then retry its stable event once.
    // A second failure blocks prepare, so a weak rating cannot miss old exposures.
    if (pending.has(id)) await pending.get(id).catch(() => {});
    if (outbox.get(id)?.length) await drain(id);
  }
  ctx.on("agent/pre-step", async ({ agent, turn, step }, next) => {
    const decision = await next(), id = String(agent.session.id);
    if (decision.kind !== "enter" || step !== 1) return decision;
    await consent.ready;
    if (consent.sessions[id]?.enabled !== true) return decision;
    await ready;
    if (!await consent.enabled(id)) return decision;
    const admitted = decision.messages.filter((m) => m.source?.kind === "user").map(messageText).filter(Boolean);
    if (!admitted.length) return decision;
    try {
      if(agentService)await syncVerificationTools(agent);
      await afterPending(id);
      const state = await request("prepare", { session_id: id, turn, history: history(agent.session), query: admitted.join("\n\n") }, id);
      if (!await consent.enabled(id)) return decision;
      if (!ctx.tokenMeter) throw new Error("当前DSH缺少tokenMeter服务，未移动会话窗口");
      if (state.evicted_through > state.committed_turns) throw new Error("服务端尚未提交历史，拒绝移出窗口");
      replacePrefix(agent.session, ctx.tokenMeter, state);
      views.set(id, state);
      return state.memory_delta?.message_text ? { ...decision, messages: [...decision.messages, {
        id: "dsh-interval-memory:" + turn + ":" + randomUUID(),
        role: "user",
        source: { kind: "user" },
        content: [{ type: "text", text: state.memory_delta.message_text }]
      }] } : decision;
    } catch (e) {
      error(e);
      throw e;
    }
  }, { global: true });
  ctx.on("session/event", (session, event) => {
    const id = String(session.id);
    if (event.type === "assistant/message" && (event.data?.usage || event.data?.message?.source?.provider) && views.has(id)) {
      const exposureTurn = views.get(id).turn;
      enqueue(id, "expose", { session_id: id, turn: exposureTurn, event_id: String(event.seq ?? event.data.id) });
      return;
    }
    if (event.type !== "turn/end" || !views.has(id)) return;
    enqueue(id, "complete", {
      session_id: id,
      turn: event.data.turn,
      history: history(session),
      memory_generation: views.get(id)?.memory_generation
    });
  }, { global: true });
  ctx.inject(["webServer"], (web) => web.effect(() => web.webServer.register({ kind: "prefix", path: "/dsh-memory-bridge", handler: async (req, res) => {
    if (!isTrustedRequest(req, req.method !== "GET")) return sendJson(res, 403, { error: "Request rejected" });
    try {
      await ready;
      const url = new URL(req.url, "http://127.0.0.1"), path = url.pathname.slice("/dsh-memory-bridge/".length);
      if (path === "manager/verified-memory" && req.method === "GET") {
        const id=url.searchParams.get('session_id');
        if(typeof id!=='string'||!id||id.length>256)return sendJson(res,400,{error:'Invalid session ID'});
        return sendJson(res,200,{enabled:await consent.enabled(id),records:await verificationStore.list(consent.owner(),id),verification_source:'actor_with_observed_evidence'});
      }
      if (path === "status" && req.method === "GET") return sendJson(res, 200, { server: { url: connection.serverUrl, token_configured: !!connection.apiToken }, errors: logs });
      if (path === "manager/registry" && req.method === "PUT") {
        const b = await readJson(req);
        await store.saveServerUrl(b.server_url);
        if (b.api_token?.trim()) await store.saveApiToken(b.api_token.trim());
        const s = await store.loadConfig();
        if (s.serverUrl !== connection.serverUrl || s.apiToken !== connection.apiToken) {
          for (const set of active.values()) for (const c of set) c.abort();
          await consent.ready;
          for (const id of Object.keys(consent.sessions)) await consent.set(id, false);
          for(const entry of verificationTools.values())entry.dispose();
          verificationTools.clear();
          views.clear();
          outbox.clear();
          await persistOutbox();
        }
        connection = { serverUrl: s.serverUrl, apiToken: s.apiToken };
        return sendJson(res, 200, { saved: true });
      }
      if (path === "manager/client-error" && req.method === "POST") {
        const b = await readJson(req);
        error(String(b.message || "客户端错误").slice(0, 4e3));
        return sendJson(res, 200, { saved: true });
      }
      if (path === "manager/check" && req.method === "POST") return sendJson(res, 200, await request("account"));
      if (path === "manager/evolith") {
        const id = url.searchParams.get("session_id");
        if (!id || id.length > 256) return sendJson(res, 400, { error: "Invalid session ID" });
        if (req.method === "GET") return sendJson(res, 200, { enabled: await consent.enabled(id) });
        if (req.method === "PUT") {
          const b = await readJson(req);
          const saved = await consent.set(id, b.enabled);
          if (!b.enabled) {
            for (const c of active.get(id) || []) c.abort();
            views.delete(id);
            outbox.delete(id);
            await persistOutbox();
          }
          if(agentService?.get){const agent=agentService.get(id);if(agent)await syncVerificationTools(agent);}
          return sendJson(res, 200, saved);
        }
      }
      return sendJson(res, 404, { error: "Not found" });
    } catch (e) {
      error(e);
      return sendJson(res, 400, { error: e.message });
    }
  } }), "Evolith local controls"));
  return { consent, ready, logs, request, history, verificationStore, syncVerificationTools };
}
export {
  installEvolithBridge
};
