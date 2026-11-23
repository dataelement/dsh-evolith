/** Deterministic BizAgentBench case_022 against the installed DSH kernel. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';

const here=fileURLToPath(new URL('.',import.meta.url));
const kernel=process.env.DSH_KERNEL_ROOT || '/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules';
const bridge=resolve(process.env.DSH_BRIDGE_ROOT || join(here,'../../..'));
const output=resolve(process.env.DSH_TEST_OUTPUT || join(here,'results',new Date().toISOString().replace(/[:.]/g,'-')));
await mkdir(output,{recursive:true});
const fixtureBytes=await readFile(join(here,'fixtures/case_022.json'));
const fixture=JSON.parse(fixtureBytes);
const load=name=>import(pathToFileURL(join(kernel,'@deepseek-ai',name,'lib/index.js')).href);
const {Context}=await load('cordis');
const llm=await load('dsh-llm');
const {Session}=await load('dsh-session');
const {sessionFormatCatalog}=await load('dsh-session-format-catalog');
const {installEvolithBridge}=await import(pathToFileURL(join(bridge,'src/evolith-runtime.js')));
const {EvolithConsent}=await import(pathToFileURL(join(bridge,'src/evolith-consent.js')));
const {VerifiedMemoryStore,VERIFIED_MEMORY_TOOL}=await import(pathToFileURL(join(bridge,'src/verified-memory.js')));
const rounds=fixture.rounds;
const countSteps=rs=>rs.reduce((n,r)=>n+r.steps.length,0);
const countTools=rs=>rs.reduce((n,r)=>n+r.steps.reduce((n,s)=>n+s.calls.length,0),0);
const report={case_id:fixture.case_id,started_at:new Date().toISOString(),kernel,bridge,
  fixture_sha256:createHash('sha256').update(fixtureBytes).digest('hex'),
  recorded_strict_success:fixture.source.recorded_strict_success,
  replay_rounds:rounds.length,recorded_model_responses:countSteps(rounds),recorded_actor_tools:countTools(rounds),
  external_model_requests:0,production_memory_requests:0,
  scope:'Real installed AgentLoop, tools, Session, TokenMeter and Evolith plugin; deterministic model/tool replay and local Memory contract double. CSS computed-style test, not a full Electron UI test. No new business-world scoring or model-accuracy measurement.',checks:[]};
report.kernel_version=JSON.parse(await readFile(join(kernel,'@deepseek-ai/dsh-agent-loop/package.json'))).version;
report.plugin_version=JSON.parse(await readFile(join(bridge,'package.json'))).version;
const errors=[];
function deadline(work,ms,label){let timer;return Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),ms)})]).finally(()=>clearTimeout(timer));}
async function until(check,label){await deadline((async()=>{while(!await check())await new Promise(r=>setTimeout(r,5))})(),3000,label);}

async function runReplay({name,enabled=true,rs=rounds,memoryFailure=false,slowComplete=false,verificationProbe=false,enableAtTurn=1,disableAtTurn=0,reenableAtTurn=0}) {
  const ctx=new Context(),temp=await mkdtemp(join(tmpdir(),'bizagent-dsh-'));
  const stats={name,enabled,rounds:0,model_calls:0,tool_calls:0,prepare_turns:[],memory_insertions:[],evictions:[],round_checks:[],status_events:[],background_complete_blocked:false,stable_prefix_checks:0,native_boundary_checks:0};
  let previousRequest,previousSegment;
  let handle,runtime,turn=0,step=0,pendingCalls=[],sent=0,committed=0,completeStarted=false,release;
  const blocked=new Promise(r=>release=r);
  const calls=[];
  try {
    // Use genuine installed services; no hand-written Session or Agent loop.
    for(const name of ['dsh-session','dsh-session-projection','dsh-agent','dsh-llm','dsh-system-prompt','dsh-tools','dsh-tool-executor-native','dsh-agent-loop','dsh-token-meter']) {
      const module=await load(name);
      await ctx.plugin(module.default || module,name==='dsh-agent-loop'?{agents:[],maxParallelToolCalls:1}:name==='dsh-system-prompt'?{includeHarnessIdentity:false}:{});
    }
    ctx.on('agent/status',({status})=>stats.status_events.push(status),{global:true});
    class RecordedAdapter extends llm.LlmAdapter {
      async *stream(request) {
        assert.equal(pendingCalls.length,0,'DSH requested another model step before consuming recorded tool calls');
        const record=rs[turn-1]?.steps[step++];
        assert.ok(record,`Unexpected extra model request: turn ${turn}, step ${step}`);
        assert.ok(request.messages.some(m=>m.role==='user'&&m.content.some(b=>b.text===rs[turn-1].query)),'Current user query missing from model context');
        assert.ok(request.messages.some(m=>m.role==='system'&&m.content.some(b=>b.text?.startsWith('BizAgentBench deterministic DSH regression.'))),'System prompt lost during window shift');
        assert.equal((request.tools||[]).some(t=>t.name===VERIFIED_MEMORY_TOOL),enabled,'Verification tool must be scoped to opted-in sessions');
        if(enabled)assert.ok(request.messages.some(m=>m.role==='system'&&m.content.some(b=>b.text?.includes('MEMORY USE REPORTING POLICY'))),'Evolith system policy lost during window shift');
        const memory=request.messages.filter(m=>m.id?.startsWith('dsh-interval-memory:'));
        assert.equal(new Set(memory.map(m=>m.id)).size,memory.length,'Duplicate memory message IDs');
        if(enabled&&turn>=5)assert.ok(memory.length,'Expected frozen memory is missing from the real model request');
        if(!enabled)assert.equal(memory.length,0,'Memory leaked into disabled session');
        if(step===1&&enabled){
          const state=calls.filter(x=>x.path==='prepare').at(-1).response;
          const prior=request.messages.flatMap(m=>m.content||[]).filter(b=>b.type==='text').map(b=>b.text);
          for(let n=1;n<turn;n++) {
            if(n<=state.evicted_through)assert.ok(!prior.includes(rs[n-1].query),`Expired round ${n} still present`);
            else assert.ok(prior.includes(rs[n-1].query),`Retained round ${n} lost`);
          }
          const current=memory.filter(m=>m.id.startsWith(`dsh-interval-memory:${turn}:`));
          assert.equal(current.length,state.memory_delta.message_text?1:0,'Wrong insertion boundary');
          if(current.length){
            const index=request.messages.indexOf(current[0]);
            assert.equal(request.messages[index-1].content[0].text,rs[turn-1].query,'Memory must follow current user input');
            stats.memory_insertions.push(turn);
          }
          stats.evictions.push({turn,through:state.evicted_through,committed:state.committed_turns});
        }
        const segment=Math.floor((turn-1)/4)*4+1;
        if(previousRequest&&(!enabled||segment===previousSegment)){
          // Message IDs are log metadata, not model-facing text/cache input.
          const wireMessages=messages=>messages.map(({id,source,...message})=>message);
          assert.deepEqual(wireMessages(request.messages.slice(0,previousRequest.length)),wireMessages(previousRequest),'Model-facing context prefix changed inside a frozen segment');
          stats.stable_prefix_checks++;
        }
        previousRequest=structuredClone(request.messages);previousSegment=segment;
        stats.model_calls++;
        pendingCalls=record.calls.filter(c=>c.name!==VERIFIED_MEMORY_TOOL).map(c=>({...c}));
        let index=0;
        if(record.text){yield {type:'block-start',index,blockType:'text'};yield {type:'text-delta',index,text:record.text};yield {type:'block-end',index,block:{type:'text',text:record.text}};index++;}
        for(const c of record.calls){
          yield {type:'block-start',index,blockType:'tool-call'};
          yield {type:'tool-call-delta',index,id:c.id,name:c.name,argumentsDelta:JSON.stringify(c.arguments)};
          yield {type:'block-end',index,block:{type:'tool-call',id:c.id,name:c.name,arguments:JSON.stringify(c.arguments)}};index++;
        }
        // This usage is synthetic test data, never counted as new model usage.
        yield {type:'usage',usage:{inputTokens:1,outputTokens:1,totalTokens:2}};
        yield {type:'finish',reason:{kind:record.calls.length?'tool-calls':'stop'}};
      }
    }
    ctx.llm.registerAdapter(['bizagent-replay'],new RecordedAdapter());
    ctx.systemPrompt.section({name:'bizagent-regression',order:1,text:'BizAgentBench deterministic DSH regression.'});
    const tools=[...new Set(rs.flatMap(r=>r.steps.flatMap(s=>s.calls.map(c=>c.name))))];
    for(const name of tools.filter(n=>n!==VERIFIED_MEMORY_TOOL))ctx.tools.register({name,description:'Recorded BizAgentBench tool '+name,parameters:{type:'object',properties:{},additionalProperties:true},
      output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
      async execute(args,exec){
        const c=pendingCalls.shift();assert.ok(c,'Unexpected tool call');assert.equal(name,c.name);
        assert.equal(exec.callId,c.id,'Tool call ID changed');
        assert.deepEqual(args,c.arguments,'Tool arguments changed');
        assert.equal(c.is_error,false,'Recorded tool errors require an explicit replay error path');
        stats.tool_calls++;return c.result;
      }});
    const consent=new EvolithConsent();
    const verificationStore=new VerifiedMemoryStore(join(temp,'verified.json'));
    const addVerification=verificationStore.add.bind(verificationStore);
    verificationStore.add=async(...args)=>{const record=await addVerification(...args);stats.tool_calls++;return record;};
    const fakeFetch=async(url,options)=>{
      assert.ok(url.startsWith('http://memory.test.invalid/v1/evolith/'),'Unexpected network destination');
      const path=url.split('/').at(-1),body=JSON.parse(options.body),call={path,turn:body.turn};calls.push(call);
      assert.equal(body.session_id,'bizagent-regression-'+name);
      if(path==='prepare'){
        stats.prepare_turns.push(body.turn);
        assert.ok(!JSON.stringify(body.history).includes('RETRIEVED HISTORICAL MEMORY'),'Injected memory was uploaded as raw public history');
        assert.ok(!JSON.stringify(body.history).includes('Original conversation rounds through'),'Prune marker was uploaded as user input');
        if(memoryFailure)return {ok:false,json:async()=>({detail:'INJECTED_MEMORY_PREPARE_FAILURE'})};
        const firstLateRead=enableAtTurn>1&&body.turn===enableAtTurn;
        if(firstLateRead)assert.ok(body.history.some(m=>m.turn===1&&m.role==='assistant'),'Disabled first-turn history was not backfilled');
        const segment=Math.floor((body.turn-1)/4)*4+1,cutoff=Math.max(0,segment-8);
        assert.ok(committed>=cutoff,'Window eviction outran committed writer');
        const response={turn:body.turn,evicted_through:cutoff,committed_turns:committed,memory_generation:Math.floor(committed/4),
          memory_delta:{message_text:(firstLateRead||body.turn===segment&&body.turn>=5)?(verificationProbe?'RETRIEVED HISTORICAL MEMORY\n\n[Memory regression-confirmed-fact]\nSource batch: test fixture, business rounds 1-1.\nFeedback exposures: 0 | Positive rate: N/A\nThe bank can accept a technically authenticated payment above that company limit, but this is not an authorized company execution.':`RETRIEVED HISTORICAL MEMORY\nRecorded integration fixture, frozen segment ${segment}. Historical public query: ${rs[Math.max(0,segment-5)].query}`):''}};
        call.response=response;return {ok:true,json:async()=>response};
      }
      if(path==='complete'){
        completeStarted=true;
        if(slowComplete){stats.background_complete_blocked=true;await blocked;}
        sent=body.turn;committed=Math.floor(sent/4)*4;
        assert.ok(body.history.some(m=>m.role==='assistant'),'Completed assistant reply missing from writer history');
      }else assert.equal(path,'expose');
      return {ok:true,json:async()=>({accepted:true})};
    };
    await ctx.plugin({name:'evolith-bizagent-regression',inject:['tokenMeter'],apply(scope){runtime=installEvolithBridge(scope,{}, {consent,verificationStore,fetchImpl:fakeFetch,outboxPath:join(temp,'outbox.json'),store:{loadConfig:async()=>({serverUrl:'http://memory.test.invalid',apiToken:'test-only-not-a-real-token'})}});}});
    await runtime.ready;
    if(enableAtTurn>1)enabled=false;
    if(enabled)await consent.set('bizagent-regression-'+name,true);else await consent.resetForConnection('bizagent-regression-'+name);
    handle=await ctx.agents.create({sessionId:'bizagent-regression-'+name,agentOptions:{provider:'bizagent-replay',model:'recorded-case-022'}});
    if(enabled&&!verificationProbe){await consent.set(handle.agent.session.id,true);await runtime.syncVerificationTools(handle.agent);}
    if(verificationProbe){await consent.resetForConnection('another-disabled-conversation');const other=await ctx.agents.create({sessionId:'another-disabled-conversation',agentOptions:{provider:'bizagent-replay',model:'recorded-case-022'}});try{assert.ok(!other.agent.ctx.get('tools').schemas().some(t=>t.name===VERIFIED_MEMORY_TOOL),'Verification tool leaked into another disabled conversation')}finally{await other.dispose()}}

    for(const [i,r] of rs.entries()){
      turn=i+1;step=0;
      if(turn===disableAtTurn||turn===reenableAtTurn){
        enabled=turn===reenableAtTurn;await consent.set(handle.agent.session.id,enabled);await runtime.syncVerificationTools(handle.agent);previousRequest=null;
      }
      if(enableAtTurn>1&&turn===enableAtTurn){
        enabled=true;await consent.set(handle.agent.session.id,true);await runtime.syncVerificationTools(handle.agent);
        previousRequest=null;
      }
      handle.agent.followup(llm.createUserMessage({source:{kind:'user'},content:[{type:'text',text:r.query}]}));
      await deadline(handle.agent.whenIdle(),5000,`DSH turn ${turn} return to idle`);
      const events=handle.agent.session.snapshotEvents(),end=events.at(-1);
      assert.equal(handle.agent.status,'idle','Agent still marked running after reply');
      assert.equal(stats.status_events.at(-1),'idle','No idle notification for frontend');
      assert.equal(end.type,'turn/end','Turn did not close');
      if(memoryFailure){
        assert.equal(end.data.reason.kind,'error');assert.match(JSON.stringify(end),/INJECTED_MEMORY_PREPARE_FAILURE/);assert.equal(stats.model_calls,0);
        stats.error_surfaced=true;break;
      }
      assert.equal(end.data.reason.kind,'completed',JSON.stringify(end));
      assert.equal(step,r.steps.length,'Model step count mismatch');assert.equal(pendingCalls.length,0);
      assert.equal(events.filter(e=>e.type==='turn/start').length,turn,'Tool or memory counted as a user round');
      assert.equal(events.filter(e=>e.type==='turn/end').length,turn,'Missing or duplicate turn closure');
      const boundary=ctx.agents.turnBoundaryOf(handle.agent.session);
      assert.ok(boundary,'Native turnBoundary projection is missing');
      assert.equal(boundary.openTurnStartSeq,null,'Native turnBoundary projection remains open');stats.native_boundary_checks++;
      const actualResults=events.filter(e=>e.type==='tool/result');
      const expectedResults=rs.slice(0,turn).flatMap(r=>r.steps.flatMap(s=>s.calls));
      assert.equal(actualResults.length,expectedResults.length,'Lost or duplicate tool results');
      for(const [index,e] of actualResults.entries()){
        const block=handle.agent.session.deriveEventMessage(e);
        assert.equal(block.toolCallId,expectedResults[index].id,'Tool result linked to the wrong call');
        assert.equal(block.isError,false,'DSH tool dispatcher produced an unexpected error');
        if(expectedResults[index].name===VERIFIED_MEMORY_TOOL){const value=JSON.parse(block.content[0].text);assert.equal(value.recorded,true);assert.equal(value.memory_id,'regression-confirmed-fact');}
        else assert.equal(block.content[0].text,expectedResults[index].result,'Tool response content changed');
      }
      // Exercise the same strict format admission used when Desktop reopens a log.
      const session=handle.agent.session;
      const rows=[sessionFormatCatalog.encodeCurrentHeader({...session.header,delegationDepth:0},session.inheritedEventCount),...events.map(e=>sessionFormatCatalog.encodeCurrentEvent(e))];
      const filename=join(temp,'session.v4.jsonl.zstd');
      await writeFile(filename,Buffer.concat([zstdCompressSync(Buffer.from(JSON.stringify(rows[0])+'\n')),zstdCompressSync(Buffer.from(rows.slice(1).map(r=>JSON.stringify(r)).join('\n')+'\n'))]));
      const stored=execFileSync(process.env.DSH_ZSTD||'zstd',['-d','-c',filename],{maxBuffer:64*1024*1024}).toString().trimEnd().split('\n').map(s=>JSON.parse(s));
      const reader=sessionFormatCatalog.createRestore(stored[0],{recovery:'strict',validation:'current'});
      for(const row of stored.slice(1))reader.decodeRow(row);
      const artifact=reader.finish();
      const restored=Session.create(artifact.header.id,artifact.events,artifact.header,artifact.inheritedEventCount);
      assert.deepEqual(restored.snapshotEvents(0,events.length),events,'Persist/reopen changed the saved event log');
      assert.equal(restored.snapshotEvents().at(-1).type,'session/end-seed','Native restoration must close its seed');
      assert.deepEqual(restored.surface.nodes,session.surface.nodes,'Persist/reopen changed the retained window');
      assert.deepEqual(restored.deriveMessages(),session.deriveMessages(),'Persist/reopen changed model history');
      stats.storage_roundtrip_checks=(stats.storage_roundtrip_checks||0)+1;
      stats.rounds++;stats.round_checks.push({turn,steps:step,status:'idle',end_reason:end.data.reason.kind});
    }
    if(enabled&&!memoryFailure){
      await until(()=>completeStarted,'complete event delivered');
      if(slowComplete){assert.equal(sent,0,'Slow memory request unexpectedly finished');stats.idle_while_memory_blocked=handle.agent.status==='idle';release();}
      await until(()=>sent===stats.rounds,'final complete delivered');
      await until(async()=>{try {const data=JSON.parse(await readFile(join(temp,'outbox.json')));return data.queues.every(([,jobs])=>jobs.length===0)} catch{return false}},'memory outbox drained');
      assert.equal(runtime.logs.length,0,JSON.stringify(runtime.logs));
    }
    if(!enabled){assert.equal(calls.length,0,'Disabled mode contacted memory service');}
    if(!memoryFailure){assert.equal(stats.model_calls,countSteps(rs));assert.equal(stats.tool_calls,countTools(rs));}
    if(verificationProbe){const saved=await verificationStore.list(consent.owner(),handle.agent.session.id);assert.equal(saved.length,1);assert.equal(saved[0].memory_id,'regression-confirmed-fact');assert.equal(saved[0].usage_source,'actor_reported_use');assert.equal(saved[0].benefit_type,'avoid_error');assert.match(saved[0].memory_text,/not an authorized company execution/);stats.verified_records=saved.length;await consent.set(handle.agent.session.id,false);await runtime.syncVerificationTools(handle.agent);assert.ok(!handle.agent.ctx.get('tools').schemas().some(t=>t.name===VERIFIED_MEMORY_TOOL),'Tool still exposed after opt-out');}
    stats.prune_events=handle.agent.session.snapshotEvents().filter(e=>e.type==='compaction/prune').length;
    stats.api_calls=calls.map(c=>({path:c.path,turn:c.turn}));
    return stats;
  } finally {
    if(handle)await writeFile(join(output,name+'.events.json'),JSON.stringify(handle.agent.session.snapshotEvents(),null,2));
    await writeFile(join(output,name+'.json'),JSON.stringify(stats,null,2)+'\n');
    release?.();await handle?.dispose();await ctx.fiber.dispose();await rm(temp,{recursive:true,force:true});
  }
}

async function check(name,fn){const start=performance.now();try{const value=await fn();report.checks.push({name,passed:true,seconds:(performance.now()-start)/1000,...value});console.log('PASS '+name)}catch(e){report.checks.push({name,passed:false,error:e.stack,seconds:(performance.now()-start)/1000});errors.push(e);console.error('FAIL '+name+'\n'+e.stack)}}
for(const enableAtTurn of [2,6])await check(`enable_on_turn_${enableAtTurn}_reads_memory_and_backfills_history`,async()=>{
  const s=await runReplay({name:'late_enable_'+enableAtTurn,rs:rounds,enableAtTurn});
  assert.deepEqual(s.prepare_turns,Array.from({length:47-enableAtTurn},(_,i)=>i+enableAtTurn));
  assert.ok(s.memory_insertions.includes(enableAtTurn),'Late activation did not deliver memory to Actor');
  return {prepare_turns:s.prepare_turns,memory_insertions:s.memory_insertions,initial_disabled_turns:enableAtTurn-1,native_rounds:s.rounds,persistence_reopens:s.storage_roundtrip_checks};
});
await check('close_on_turn_2_and_reopen_on_turn_3',async()=>{
 const s=await runReplay({name:'toggle_reopen',rs:rounds,disableAtTurn:2,reenableAtTurn:3});
 assert.deepEqual(s.prepare_turns,[1,...Array.from({length:44},(_,i)=>i+3)]);
 assert.ok(s.memory_insertions.includes(5));
 return {prepare_turns:s.prepare_turns,memory_insertions:s.memory_insertions,native_rounds:s.rounds};
});
await check('full_case_memory_off',async()=>{const s=await runReplay({name:'memory_off',enabled:false});return {rounds:s.rounds,model_calls:s.model_calls,tool_calls:s.tool_calls}});
await check('full_case_memory_on',async()=>{const s=await runReplay({name:'memory_on'});assert.ok(s.stable_prefix_checks>90);assert.equal(s.native_boundary_checks,46);assert.equal(s.storage_roundtrip_checks,46);assert.deepEqual(s.memory_insertions,Array.from({length:11},(_,i)=>5+4*i));return {rounds:s.rounds,model_calls:s.model_calls,tool_calls:s.tool_calls,insertions:s.memory_insertions,stable_prefix_checks:s.stable_prefix_checks,native_boundary_checks:s.native_boundary_checks,storage_roundtrip_checks:s.storage_roundtrip_checks}});
await check('slow_memory_completion_does_not_keep_agent_running',async()=>{const s=await runReplay({name:'slow_complete',rs:rounds.slice(0,1),slowComplete:true});assert.equal(s.idle_while_memory_blocked,true);return {idle_while_memory_blocked:true}});
await check('memory_failure_is_visible_and_turn_closes',async()=>{const s=await runReplay({name:'memory_failure',rs:rounds.slice(0,1),memoryFailure:true});assert.equal(s.error_surfaced,true);return {error_surfaced:true}});

await check('memory_usage_tool_resolves_memory_id_in_native_loop',async()=>{
  const rs=structuredClone(rounds.slice(0,5));
  rs[4].steps.splice(-1,0,{text:'',calls:[{id:'case022-verify-memory-1',name:VERIFIED_MEMORY_TOOL,arguments:{benefit_type:'avoid_error',memory_id:'regression-confirmed-fact',title:'银行受理不代表公司已授权',usage_summary:'根据记忆区分银行受理与公司授权，规避把银行受理误当成公司批准的风险。'},result:'',is_error:false}]});
  const s=await runReplay({name:'verified_memory',rs,verificationProbe:true});return {verified_records:s.verified_records,real_tool_dispatched:true,tool_removed_on_connection_reset:true};
});

// Evaluate the shipped stylesheet using a real DOM/CSS engine. No user app is controlled.
await check('memory_hidden_only_in_chat_not_in_model_history',async()=>{
  const require=createRequire(import.meta.url);
  let domEntry=process.env.DSH_JSDOM_ENTRY;
  if(!domEntry){try{domEntry=require.resolve('jsdom')}catch{throw Error('Install integration_tests/bizagent-dsh devDependencies or set DSH_JSDOM_ENTRY for the CSS check')}}
  const {JSDOM}=await import(pathToFileURL(domEntry));
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>');let definition;
  runInNewContext(await readFile(join(bridge,'client.js'),'utf8'),{document:dom.window.document,window:{__ModuleLoader__:{load:d=>definition=d}}});
  const plugin=definition.factory(n=>n==='react'?{createElement(){}}:{createPortal(){}});
  const disposers=[];plugin.apply({effect:fn=>{const cleanup=fn();if(typeof cleanup==='function')disposers.push(cleanup)},slots:{inject(){},register(){}},locale:{register(){}}});
  const events=JSON.parse(await readFile(join(output,'memory_on.events.json')));
  const nativeConversation=await readFile(join(kernel,'@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),'utf8');
  const keySource=nativeConversation.match(/function conversationContextKey\(kind, id\) \{[\s\S]*?\n\t\t\}/)?.[0];
  assert.ok(keySource,'Installed DSH chat node-key contract changed; inspect UI before updating this test');
  const nativeKey=runInNewContext('('+keySource+')');
  const memory=events.filter(e=>e.type==='user/message'&&e.data.id?.startsWith('dsh-interval-memory:'));
  assert.equal(memory.length,11);
  for(const e of memory){const row=dom.window.document.createElement('div');row.dataset.chatNodeKey=nativeKey('input-message',e.data.id);row.textContent=e.data.content[0].text;dom.window.document.body.append(row);assert.equal(dom.window.getComputedStyle(row).display,'none');}
  for(const text of [rounds[0].query,'RETRIEVED HISTORICAL MEMORY pasted by a real user',rounds[0].steps.at(-1).text]){const row=dom.window.document.createElement('div');row.dataset.chatNodeKey=nativeKey('input-message','ordinary-user-id');row.textContent=text;dom.window.document.body.append(row);assert.notEqual(dom.window.getComputedStyle(row).display,'none');}
  for(const dispose of disposers)dispose();dom.window.close();return {hidden_memory_messages:memory.length,ordinary_messages_visible:true};
});

await check('legacy_prune_repair_preserves_entire_multiframe_log',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'evolith-repair-regression-'));
  try{
    const events=JSON.parse(await readFile(join(output,'memory_on.events.json')));
    const pruneCount=events.filter(e=>e.type==='compaction/prune').length;assert.ok(pruneCount>1);
    const header={version:4,id:'bizagent-regression-memory_on',createdAt:1,isSeeded:false,delegationDepth:0};
    const rows=[sessionFormatCatalog.encodeCurrentHeader(header,0),...events.map(e=>{
      const row=sessionFormatCatalog.encodeCurrentEvent(e);
      if(row.type==='compaction/prune'){const {shadowedSeqs,...data}=row.data;return {...row,data};}
      return row;
    })];
    const original=Buffer.concat(rows.map(row=>zstdCompressSync(Buffer.from(JSON.stringify(row)+'\n'))));
    const filename=join(temp,'session.v4.jsonl.zstd'),reportFile=join(temp,'repair.json'),backup=join(temp,'backup');
    await writeFile(filename,original);
    const script=join(bridge,'scripts/repair-session-log.mjs');
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_KERNEL_ROOT:kernel};
    const args=[script,'--file',filename,'--report',reportFile];
    execFileSync(process.execPath,args,{env});
    const preview=JSON.parse(await readFile(reportFile));
    assert.equal(preview.record_count,rows.length);assert.equal(preview.changes.length,pruneCount);assert.match(preview.original_error,/shadowedSeqs/);
    assert.deepEqual(await readFile(filename),original,'Preview changed source');
    execFileSync(process.execPath,[...args,'--apply','--backup-dir',backup],{env});
    assert.deepEqual(await readFile(join(backup,'session.v4.jsonl.zstd')),original,'Backup lost concatenated frames');
    const stored=execFileSync(process.env.DSH_ZSTD||'zstd',['-d','-c',filename],{maxBuffer:64*1024*1024}).toString().trimEnd().split('\n').map(line=>JSON.parse(line));
    const reader=sessionFormatCatalog.createRestore(stored[0],{recovery:'strict',validation:'current'});
    for(const row of stored.slice(1))reader.decodeRow(row);
    assert.deepEqual(reader.finish().events,events,'Repair changed any saved message/event');
    const storageContext=new Context();
    try{
      await storageContext.plugin(await load('dsh-session-persistence-jsonl'),{root:join(temp,'native-store'),compression:'zstd',listConcurrency:3});
      const target=storageContext.sessionPersistence.locate(header).path;
      await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,await readFile(filename));
      const handle=await storageContext.sessionPersistence.open(header.id,'read');
      try{const read=await handle.read();assert.deepEqual(read.events,events,'Native persistence lost saved events');}
      finally{await handle.close();}
    }finally{await storageContext.fiber.dispose();}
    execFileSync(process.execPath,args,{env});assert.equal(JSON.parse(await readFile(reportFile)).changes.length,0,'Repair is not idempotent');
    return {records:rows.length,prunes:pruneCount,all_frames_preserved:true,strict_native_reopen:true,native_persistence_read:true};
  }finally{await rm(temp,{recursive:true,force:true});}
});
report.passed=errors.length===0;report.finished_at=new Date().toISOString();
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={memory_usage_tool_resolves_memory_id_in_native_loop:'记忆验证工具 · 原生执行与持久化',full_case_memory_off:'关闭记忆 · 完整业务回放',full_case_memory_on:'开启记忆 · 完整业务回放',slow_memory_completion_does_not_keep_agent_running:'后台提交挂起 · Actor仍能结束',memory_failure_is_visible_and_turn_closes:'记忆接口失败 · 正确报错并结束',memory_hidden_only_in_chat_not_in_model_history:'记忆在前端隐藏 · 模型仍能看到'};
await writeFile(join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>BizAgentBench · DSH 自动测试</title><style>body{font:15px/1.65 system-ui;margin:40px auto;max-width:960px;padding:0 24px;color:#26344a;background:#f6f8fb}main{background:white;padding:32px;border-radius:16px}h1{font-size:26px}.success{color:#087e56}.failure{color:#b42318}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #e6eaf0}pre{white-space:pre-wrap;font-size:12px}small{color:#64748b}a{color:#2463d3}</style><main><h1>BizAgentBench 第22题 · DSH 自动测试</h1><p class="${report.passed?'success':'failure'}">${report.passed?'全部通过':'存在失败'} · ${report.checks.filter(x=>x.passed).length}/${report.checks.length}项</p><p>46轮用户请求 · 121次固定 Actor 响应 · 209次业务工具调用。记忆开、关分别完整回放一次。</p><p>真实 DSH 内核 ${escape(report.kernel_version)} · Evolith ${escape(report.plugin_version)} · 新增真实模型请求0次 · 生产 Memory 请求0次</p><table><tr><th>检查</th><th>结果</th><th>耗时</th></tr>${report.checks.map(c=>`<tr><td>${labels[c.name]||escape(c.name)}${c.error?'<details><summary>错误证据</summary><pre>'+escape(c.error)+'</pre></details>':''}</td><td class="${c.passed?'success':'failure'}">${c.passed?'通过':'失败'}</td><td>${c.seconds.toFixed(3)}秒</td></tr>`).join('')}</table><p>开启记忆时：第5、9、13……45轮共11次注入；46轮均检查原生结束状态，109对段内请求的模型可见前缀保持一致。</p><p><strong>范围：</strong>固定模型/工具轨迹和本地 Memory 接口替身，检查真实 DSH 执行链路。前端隐藏使用DOM/CSS检查，并非完整Electron窗口端到端测试；不测当前模型答题准确率，也不重新评分业务世界。</p><p><a href="report.json">机器可读报告</a> · <a href="memory_on.json">开启记忆逐轮状态</a> · <a href="memory_on.events.json">完整事件</a></p><small>${escape(report.finished_at)} · 运行目录 ${escape(output)}</small></main></html>`);
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,output,external_model_requests:0}));
process.exitCode=errors.length?1:0;
