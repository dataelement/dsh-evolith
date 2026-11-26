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
  const runtime = installEvolithBridge(ctx, {}, { consent, fetchImpl, ...options, store: { loadConfig: async () => ({ serverUrl: "http://fixture.invalid", apiToken: options.apiToken ?? "fixture-key" }) } });
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
  await f.consent.resetForConnection(f.session.id);
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
test("connection revocation while read is pending prevents injection or window movement", async () => {
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
  await f.consent.resetForConnection("session-one");
  finish();
  assert.equal(await pending, f.decision);
});
test("new sessions default on independently of another session choice", async () => {
  const store = new EvolithConsent();
  await store.set("a", true);
  assert.equal(await store.enabled("a"), true);
  assert.equal(await store.enabled("b"), true);
  await store.set("a", false);
  await store.resetForConnection("a");
  assert.equal(await store.enabled("a"), false);
  assert.equal(await store.enabled("b"), true);
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

test('exhausted exposure delivery degrades memory without blocking new inference', async () => {
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
  assert.equal(await f.hooks['agent/pre-step']({agent:{session:f.session},turn:2,step:1},async()=>f.decision),f.decision);
  assert.match(f.runtime.degraded.get(f.session.id).message,/exposure unavailable/);
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

for (const apiToken of ['', '   ']) test('missing memory key guides user to Memory settings: '+JSON.stringify(apiToken), async () => {
  let called=false;
  const f=await fixture(async()=>{called=true;throw Error('No request expected')},{apiToken});
  await assert.rejects(f.runtime.request('account'), /未填写 Evolith 记忆访问密钥.*设置 → 记忆.*检查连接.*不是聊天模型/);
  assert.equal(called,false);
});
for (const path of ['account','prepare','complete','exposures']) test('memory 401 is actionable even for non-JSON response: '+path,async()=>{
  const f=await fixture(async()=>({ok:false,status:401,json:async()=>{throw Error('HTML response')}}));
  await assert.rejects(f.runtime.request(path), /Evolith 记忆访问密钥无效或已过期.*设置 → 记忆.*检查连接.*不是聊天模型/);
});
test('memory authentication error remains actionable but does not fail native inference',async()=>{
  const f=await fixture(async()=>({ok:false,status:401,json:async()=>({detail:'API key is invalid'})}));
  await f.consent.set(f.session.id,true);
  assert.equal(await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision),f.decision);
  assert.match(f.runtime.degraded.get(f.session.id).message,/Evolith 记忆访问密钥无效或已过期.*设置 → 记忆/);
});
test('other Memory errors are not mislabeled as an invalid key',async()=>{
  const f=await fixture(async()=>({ok:false,status:500,json:async()=>({detail:'writer unavailable'})}));
  await assert.rejects(f.runtime.request('account'),/^Error: writer unavailable$/);
});

test('default-on does not override saved choices or cross account ownership',async()=>{
 const store=new EvolithConsent();store.owner=()=> 'first';
 assert.equal(await store.enabled('new'),true);
 await store.resetForConnection('off');await store.set('on',true);
 assert.equal(await store.enabled('off'),false);
 store.owner=()=> 'second';
 assert.equal(await store.enabled('on'),false);
 assert.equal(await store.enabled('new-second'),true);
 assert.equal(await store.enabled(''),false);
});

test('default-on sessions may close, persist their choice, and reopen',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const dir=await mkdtemp(join(tmpdir(),'evolith-toggle-'));
 try{
  const filename=join(dir,'consent.json');const store=new EvolithConsent(filename);store.owner=()=> 'account';
  assert.equal(await store.enabled('saved'),true);await store.set('saved',false);
  const reopened=new EvolithConsent(filename);reopened.owner=()=> 'account';
  assert.equal(await reopened.enabled('saved'),false);
  await reopened.set('saved',true);assert.equal(await reopened.enabled('saved'),true);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('default activation is persisted under its account and never overwrites a queued revocation',async()=>{
 const store=new EvolithConsent();store.owner=()=> 'first';
 assert.equal(await store.enabled('default'),true);
 assert.equal(store.sessions.default.owner,'first');
 store.owner=()=> 'second';assert.equal(await store.enabled('default'),false);
 const resetting=store.resetForConnection('race'),reading=store.enabled('race');
 await resetting;assert.equal(await reading,false);
});

test('closing during a pending read cancels memory work without a turn error',async()=>{
 let start;const started=new Promise(r=>start=r);
 const f=await fixture(async(_url,options)=>{start();await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));});
 await f.consent.set(f.session.id,true);
 const work=f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision);
 await started;
 const route=f.routes[0];
 const body=JSON.stringify({enabled:false});
 const {Readable}=await import('node:stream');const req=Readable.from([Buffer.from(body)]);
 req.url='/dsh-memory-bridge/manager/evolith?session_id='+f.session.id;req.method='PUT';
 req.headers={host:'127.0.0.1','x-dsh-memory-request':'1'};req.socket={remoteAddress:'127.0.0.1'};
 const res={writeHead(){},end(){}};
 await route.handler(req,res);
 assert.equal(await work,f.decision);assert.equal(f.runtime.logs.length,0);
});

test('empty-turn manifest certifies ended empty turns only, never real history or unseen turns',async()=>{
 const f=await fixture(async()=>{throw Error('No network')});
 const events=[{type:'turn/start',data:{turn:1}},{type:'turn/end',data:{turn:1}},{type:'turn/start',data:{turn:2}},{type:'assistant/message',data:{turn:2,message:{content:[{type:'text',text:'Background continuation'}]}}},{type:'turn/end',data:{turn:2}},{type:'turn/start',data:{turn:4}},{type:'turn/start',data:{turn:5}},{type:'turn/end',data:{turn:5}}];
 const session={snapshotEvents:()=>events};const h=f.runtime.history(session);
 assert.deepEqual(f.runtime.emptyTurns(session,h,4),[1]);
 assert.deepEqual(f.runtime.emptyTurns(session,h,5),[1,5]);
 assert.ok(!f.runtime.emptyTurns(session,h,5).includes(2));
 assert.ok(!f.runtime.emptyTurns(session,h,5).includes(3));
 assert.ok(!f.runtime.emptyTurns(session,h,5).includes(4));
});

for(const status of [409,503])test('Memory '+status+' does not interrupt the actor or modify its input',async()=>{
 const f=await fixture(async()=>({ok:false,status,json:async()=>({detail:'fixture memory failure'})}));await f.consent.set(f.session.id,true);
 const original=JSON.stringify(f.decision);
 assert.equal(await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision),f.decision);
 assert.equal(JSON.stringify(f.decision),original);assert.ok(f.runtime.degraded.get(f.session.id));
});
test('hung prepare has a bounded wait and a late response cannot prune or inject memory',async()=>{
 let release;
 const f=await fixture(async()=>new Promise(resolve=>release=resolve),{prepareWaitMs:10});await f.consent.set(f.session.id,true);
 const began=performance.now();const result=await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision);
 assert.equal(result,f.decision);assert.ok(performance.now()-began<500);assert.match(f.runtime.degraded.get(f.session.id).message,/等待超时/);
 release({ok:true,json:async()=>({evicted_through:100,committed_turns:100,memory_delta:{message_text:'late memory'}})});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(result.messages.length,1);assert.equal(result.messages[0],f.decision.messages[0]);
});
test('a hung background queue cannot hold the next actor turn',async()=>{
 let hang=false;
 const f=await fixture(async url=>hang?new Promise(()=>{}):({ok:true,json:async()=>({turn:1,evicted_through:0,committed_turns:0,memory_delta:{}})}),{prepareWaitMs:10});
 await f.consent.set(f.session.id,true);await f.hooks['agent/pre-step']({agent:{session:f.session},turn:1,step:1},async()=>f.decision);
 hang=true;f.hooks['session/event'](f.session,{type:'assistant/message',seq:2,data:{usage:{inputTokens:1}}});
 assert.equal(await f.hooks['agent/pre-step']({agent:{session:f.session},turn:2,step:1},async()=>f.decision),f.decision);
 assert.match(f.runtime.degraded.get(f.session.id).message,/等待超时/);
});

test('Evolith compaction constraints fall back to native compaction rather than stopping the actor',async()=>{
 const {constrainCompaction}=await import('../src/evolith-window.js');const calls=[],warnings=[];
 const events=[{seq:1,type:'turn/start',data:{turn:1}},{seq:2,type:'user/message',data:{role:'user',content:[]}},{seq:3,type:'turn/start',data:{turn:2}},{seq:4,type:'user/message',data:{role:'user',content:[]}}];
 const session={id:'compaction-fallback',ownEvents:()=>events,eventAt:n=>events.find(e=>e.seq===n),deriveEventMessage:e=>e?.type==='user/message'?e.data:null,surface:{nodes:[2,4]}};
 const engine={compactRegion:async(...args)=>{calls.push(args);return 'native'}};
 const dispose=constrainCompaction(engine,{enabled:async()=>true},(id,e)=>warnings.push(e.message));
 assert.equal(await engine.compactRegion(2,4,{session}), 'native');assert.deepEqual(calls[0].slice(0,2),[2,4]);assert.equal(warnings.length,1);dispose();
});
