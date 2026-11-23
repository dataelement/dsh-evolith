import { pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { installEvolithBridge } from "../src/evolith-runtime.js";
import { EvolithConsent } from "../src/evolith-consent.js";
async function fixture(fetchImpl, options = {}) {
  const hooks = {}, routes = [];
  const ctx = { on: (n, f) => {
    hooks[n] = f;
  }, inject: (_, f) => f({ effect: (f2) => f2(), webServer: { register: (r) => {
    routes.push(r);
    return () => {
    };
  } } }), tokenMeter: { measure: () => ({ totalTokens: 0, nodes: [] }) } };
  const consent = new EvolithConsent();
  const runtime = installEvolithBridge(ctx, {}, { consent, fetchImpl, ...options, store: { loadConfig: async () => ({ serverUrl: "http://fixture.invalid", apiToken: "fixture-key" }) } });
  await runtime.ready;
  const session = { id: "session-one", snapshotEvents: () => [], surface: { nodes: [] }, ownEvents: () => [] };
  const message = { source: { kind: "user" }, content: [{ type: "text", text: "User request" }] };
  const decision = { kind: "enter", messages: [message] };
  return { hooks, runtime, consent, session, decision, routes };
}
test("disabled sessions send no history, queries, telemetry or writes", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    throw Error("Unexpected network");
  });
  const input = { agent: { session: f.session }, turn: 1, step: 1 };
  assert.equal(await f.hooks["agent/pre-step"](input, async () => f.decision), f.decision);
  f.hooks["session/event"](f.session, { type: "assistant/message", data: { usage: { inputTokens: 1 } } });
  f.hooks["session/event"](f.session, { type: "turn/end", data: { turn: 1 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
test("enabled session uses opt-in endpoint and appends delta after user", async () => {
  const calls = [];
  const f = await fixture(async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ turn: 1, evicted_through: 0, committed_turns: 0, memory_delta: { message_text: "historical memory" } }) };
  });
  await f.consent.set("session-one", true);
  const result = await f.hooks["agent/pre-step"]({ agent: { session: f.session }, turn: 1, step: 1 }, async () => f.decision);
  assert.equal(result.messages[0], f.decision.messages[0]);
  assert.equal(result.messages[1].source.kind, "user");
  assert.equal(result.messages[1].content[0].text, "historical memory");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/v1/evolith/prepare"));
});
test("opt-out while read is pending prevents injection or window movement", async () => {
  let finish, started;
  const start = new Promise((resolve) => started = resolve);
  const f = await fixture(async () => {
    started();
    await new Promise((resolve) => finish = resolve);
    return { ok: true, json: async () => ({ evicted_through: 0, committed_turns: 0, memory_delta: { message_text: "stale" } }) };
  });
  await f.consent.set("session-one", true);
  const pending = f.hooks["agent/pre-step"]({ agent: { session: f.session }, turn: 1, step: 1 }, async () => f.decision);
  await start;
  await f.consent.set("session-one", false);
  finish();
  assert.equal(await pending, f.decision);
});
test("session opt-in is never inherited by another session", async () => {
  const store = new EvolithConsent();
  await store.set("a", true);
  assert.equal(await store.enabled("a"), true);
  assert.equal(await store.enabled("b"), false);
});
test("real DSH events retain public assistant/tool history and stable system prefix", async () => {
  const { Session } = await import(process.env.DSH_EVOLITH_TEST_KERNEL_ROOT ? pathToFileURL(join(process.env.DSH_EVOLITH_TEST_KERNEL_ROOT,"@deepseek-ai/dsh-session/lib/index.js")).href : "@deepseek-ai/dsh-session");
  const { createUserMessage, createAssistantMessage, createToolResultMessage, createSystemMessage } = await import(process.env.DSH_EVOLITH_TEST_KERNEL_ROOT ? pathToFileURL(join(process.env.DSH_EVOLITH_TEST_KERNEL_ROOT,"@deepseek-ai/dsh-llm/lib/index.js")).href : "@deepseek-ai/dsh-llm");
  const { replacePrefix } = await import("../src/evolith-window.js");
  const f = await fixture(async () => {
    throw Error("No network");
  });
  const s = Session.create("native-history");
  s.append("system/message", { turn: 1, step: 1, message: createSystemMessage("Permanent system") }, { surfaceOp: "append" });
  for (let t = 1; t <= 9; t++) {
    s.append("turn/start", { turn: t });
    s.append("step/start", { turn: t, step: 1 });
    s.append("user/message", createUserMessage({ content: [{ type: "text", text: "Question " + t }], source: { kind: "user" } }), { surfaceOp: "append" });
    const call = s.append("assistant/message", { turn: t, step: 1, stream: [], message: createAssistantMessage({ source: { provider: "fixture", model: "fixture" }, content: [{ type: "tool-call", id: "c" + t, name: "read", arguments: '{"path":"x"}' }, { type: "reasoning", text: "private hidden" }] }) }, { surfaceOp: "append" });
    s.append("tool/result", { turn: t, step: 1, message: createToolResultMessage({ callId: "c" + t, content: [{ type: "text", text: "Document " + t }], isError: false }) }, { surfaceOp: "append", sourceEventSeqs: [call.seq] });
    s.append("assistant/message", { turn: t, step: 1, stream: [], message: createAssistantMessage({ source: { provider: "fixture", model: "fixture" }, content: [{ type: "text", text: "Answer " + t }] }) }, { surfaceOp: "append" });
    s.append("step/end", { turn: t, step: 1 });
    s.append("turn/end", { turn: t, reason: { kind: "completed" } });
  }
  const history = f.runtime.history(s);
  assert.equal(history.length, 36);
  assert.equal(history[2].role, "tool");
  assert.match(history[2].content, /Document 1/);
  assert.match(history[1].content, /tool-call read/);
  assert.ok(!JSON.stringify(history).includes("private hidden"));
  s.append("turn/start", { turn: 10 });
  s.append("step/start", { turn: 10, step: 1 });
  const meter = { measure: (session) => ({ nodes: session.surface.nodes.map((seq) => ({ seq, heuristicTokens: 10 })) }) };
  replacePrefix(s, meter, { evicted_through: 1, committed_turns: 4 });
  assert.equal(s.deriveMessages()[0].content[0].text, "Permanent system");
  assert.ok(!s.deriveMessages().some((m) => m.content?.some((b) => b.text === "Question 1")));
  assert.equal(f.runtime.history(s).length, 36);
});

test('retry exposure and completion before preparing the next feedback boundary', async () => {
  const calls=[];let failures=0;
  const f=await fixture(async(url)=>{
    const path=url.split('/').at(-1);calls.push(path);
    if(path==='expose' && failures++===0)throw Error('temporary exposure failure');
    return {ok:true,json:async()=>({turn:calls.filter(x=>x==='prepare').length,evicted_through:0,committed_turns:0,memory_delta:{}})};
  });
  await f.consent.set('session-one',true);
  await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision);
  f.hooks['session/event'](f.session,{type:'assistant/message',seq:12,data:{usage:{inputTokens:1}}});
  f.hooks['session/event'](f.session,{type:'turn/end',data:{turn:1}});
  await new Promise(resolve=>setImmediate(resolve));
  await f.hooks['agent/pre-step']({agent:{session:f.session},turn:2,step:1},async()=>f.decision);
  assert.deepEqual(calls,['prepare','expose','expose','complete','prepare']);
});

test('exhausted exposure delivery blocks new inference instead of rating incomplete pending memory', async () => {
  const calls=[];
  const f=await fixture(async(url)=>{
    const path=url.split('/').at(-1);calls.push(path);
    if(path==='expose')throw Error('exposure unavailable');
    return {ok:true,json:async()=>({turn:1,evicted_through:0,committed_turns:0,memory_delta:{}})};
  });
  await f.consent.set('session-one',true);
  await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision);
  f.hooks['session/event'](f.session,{type:'assistant/message',seq:12,data:{usage:{inputTokens:1}}});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.hooks['agent/pre-step']({agent:{session:f.session},turn:2,step:1},async()=>f.decision),/exposure unavailable/);
  assert.deepEqual(calls,['prepare','expose','expose']);
});

test('restart restores a failed exposure before the next prepare, with a private outbox file', async () => {
  const {mkdtemp,readFile,rm,stat}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const root=await mkdtemp(join(tmpdir(),'evolith-outbox-'));
  try {
    const file=join(root,'pending.json');
    const before=await fixture(async(url)=>{
      if(url.endsWith('/expose'))throw Error('offline');
      return {ok:true,json:async()=>({turn:1,evicted_through:0,committed_turns:0,memory_delta:{}})};
    },{outboxPath:file});
    await before.consent.set('session-one',true);
    await before.hooks['agent/pre-step']({agent:{session:before.session},turn:1,step:1},async()=>before.decision);
    before.hooks['session/event'](before.session,{type:'assistant/message',seq:100,data:{usage:{inputTokens:1}}});
    for(let i=0;i<30;i++){
      if(before.runtime.logs.length)break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const saved=JSON.parse(await readFile(file,'utf8'));
    assert.equal(saved.queues[0][1][0].path,'expose');
    assert.equal((await stat(file)).mode & 0o777,0o600);
    const calls=[];
    const after=await fixture(async(url)=>{calls.push(url.split('/').at(-1));return {ok:true,json:async()=>({turn:2,evicted_through:0,committed_turns:0,memory_delta:{}})};},{outboxPath:file});
    await after.consent.set('session-one',true);
    await after.hooks['agent/pre-step']({agent:{session:after.session},turn:2,step:1},async()=>after.decision);
    assert.deepEqual(calls,['expose','prepare']);
    assert.equal(JSON.parse(await readFile(file,'utf8')).queues[0][1].length,0);
  } finally {await rm(root,{recursive:true,force:true});}
});
