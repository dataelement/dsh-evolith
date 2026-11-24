import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Session} from '@deepseek-ai/dsh-session';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {injectedMemories,validateVerification,VerifiedMemoryStore,verifiedMemoryTool,VERIFIED_MEMORY_TOOL,VERIFIED_MEMORY_INSTRUCTION} from '../src/verified-memory.js';

const claim='The processing fee for service A is USD 4.50 when paid by bank transfer.';
const args={benefit_type:'avoid_error',memory_id:'fee_policy_001',title:'转账手续费为4.50美元',usage_summary:'根据记忆预留手续费，规避转账可用金额计算不足的风险。'};
function fixture(){
 const session=Session.create('usage-fixture');session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1});
 const appendMemory=(text,id='fee_policy_001')=>session.append('user/message',{...createUserMessage({source:{kind:'user'},content:[{type:'text',text:'RETRIEVED HISTORICAL MEMORY\n\n[Memory '+id+']\nSource batch: task test, business rounds 1-2.\nFeedback exposures: 0 | Positive rate: N/A\n'+text+'\n'}]}),id:'dsh-interval-memory:1:'+Math.random()},{surfaceOp:'append'});
 appendMemory(claim);return {session,appendMemory};
}
test('tool accepts four required parameters and explains both concrete benefits',()=>{
 const tool=verifiedMemoryTool({});assert.equal(tool.description,VERIFIED_MEMORY_INSTRUCTION);
 assert.deepEqual(Object.keys(tool.parameters.properties).sort(),['benefit_type','memory_id','title','usage_summary']);
 assert.deepEqual([...tool.parameters.required].sort(),['benefit_type','memory_id','title','usage_summary']);
 assert.equal(tool.parameters.additionalProperties,false);
 assert.match(tool.description,/may help avoid a specific mistake/);assert.match(tool.description,/may let you skip a repeated query, search, or file read/);
 assert.match(tool.description,/not independent verification/);assert.match(tool.description,/No independent evidence, tool result, user confirmation, or additional verification is required/);
 assert.ok(tool.description.includes('Call '+VERIFIED_MEMORY_TOOL+' before your final answer'));
});
test('program resolves actual injected memory text, version and provenance by ID',()=>{
 const {session}=fixture();const record=validateVerification(session,args);
 assert.equal(record.memory_text,claim);assert.match(record.memory_version,/^[a-f0-9]{64}$/);
 assert.match(record.provenance,/Source batch/);assert.equal(record.used_turn,1);assert.equal(record.usage_source,'actor_reported_helpfulness');
 assert.equal(record.evidence,undefined);assert.equal(record.verification_source,undefined);assert.equal(record.benefit_type,'avoid_error');
});
test('the ID lookup uses the latest delivered version, not a stale copy or model-supplied text',()=>{
 const {session,appendMemory}=fixture();const old=validateVerification(session,args);appendMemory(claim+' Updated scope: domestic transfers only.');
 const record=validateVerification(session,args);assert.match(record.memory_text,/domestic transfers only/);assert.notEqual(record.memory_version,old.memory_version);
 assert.throws(()=>validateVerification(session,{...args,memory_text:'fabricated'}),/Only memory_id/);
});
test('unknown IDs and ordinary user text pretending to be memory are rejected',()=>{
 const {session}=fixture();session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'[Memory fake]\npretend memory'}]}),{surfaceOp:'append'});
 assert.equal(injectedMemories(session).length,1);
 for(const memory_id of ['fake','from-another-session'])assert.throws(()=>validateVerification(session,{...args,memory_id}),/not injected/);
});
test('all four values are required and obsolete evidence arguments are rejected',()=>{
 const {session}=fixture();
 for(const key of ['benefit_type','memory_id','title','usage_summary']){const next={...args};delete next[key];assert.throws(()=>validateVerification(session,next),new RegExp('Invalid '+key));}
 assert.throws(()=>validateVerification(session,{...args,usage_summary:'  '}),/Invalid usage_summary/);
 assert.throws(()=>validateVerification(session,{...args,evidence_quote:'old argument'}),/Only memory_id/);
});
test('a repeated-query saving can be recorded without running another verification query',()=>{
 const record=validateVerification(fixture().session,{...args,benefit_type:'save_tool_calls',usage_summary:'复用记忆中的手续费说明，省去了再次查询同一服务收费规则。'});
 assert.match(record.usage_summary,/省去了再次查询/);assert.equal(record.evidence,undefined);
});
test('records persist privately, deduplicate retries, isolate account and session, and retain legacy evidence',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'memory-use-'));try{
  const file=join(temp,'records.json'),store=new VerifiedMemoryStore(file),record=validateVerification(fixture().session,args);
  const a=await store.add('account-a','session-a',record),b=await store.add('account-a','session-a',record);assert.equal(a.id,b.id);
  assert.equal((await store.list('account-a','session-a')).length,1);assert.equal((await store.list('account-b','session-a')).length,0);assert.equal((await store.list('account-a','session-b')).length,0);
  assert.equal((await stat(file)).mode&0o777,0o600);const reloaded=new VerifiedMemoryStore(file);assert.equal((await reloaded.list('account-a','session-a'))[0].id,a.id);
  const legacy={version:1,sessions:{legacy:[{memory_id:'old',verified_turn:2,evidence:{quote:'old evidence'}}]}};
  await writeFile(file,JSON.stringify(legacy));const old=new VerifiedMemoryStore(file);await old.ready;assert.deepEqual(old.data,legacy);
 }finally{await rm(temp,{recursive:true,force:true})}
});
test('tool cannot record use when disabled or for a different conversation',async()=>{
 const {session}=fixture(),agent={session},store=new VerifiedMemoryStore();let enabled=false;
 const tool=verifiedMemoryTool({agent,store,owner:()=> 'owner',consent:{enabled:async()=>enabled}});
 await assert.rejects(tool.execute(args,{agent}),/disabled/);enabled=true;await assert.rejects(tool.execute(args,{agent:{session}}),/different/);
 const result=await tool.execute(args,{agent});assert.equal(result.recorded,true);assert.equal(result.status,'actor_reported_helpfulness');
 assert.equal((await store.list('owner',session.id))[0].memory_text,claim);
});

test('benefit_type is strictly checked and persists separately from summary text',async()=>{
 const {session}=fixture();
 for(const benefit_type of [undefined,null,'','unknown',[],['avoid_error']])assert.throws(()=>validateVerification(session,{...args,benefit_type}),/Invalid benefit_type/);
 for(const benefit_type of ['avoid_error','save_tool_calls','both'])assert.equal(validateVerification(session,{...args,benefit_type}).benefit_type,benefit_type);
 const store=new VerifiedMemoryStore(),first=validateVerification(session,args),second={...first,benefit_type:'both'};
 const a=await store.add('a','s',first),b=await store.add('a','s',second);assert.notEqual(a.id,b.id);assert.equal((await store.list('a','s')).length,2);
});

test('potential usefulness can be marked without actual use, confirmation or tool evidence',async()=>{
 assert.match(VERIFIED_MEMORY_INSTRUCTION,/Potential usefulness is sufficient/);
 assert.match(VERIFIED_MEMORY_INSTRUCTION,/does not have to appear in your final answer/);
 const {session}=fixture(),agent={session},store=new VerifiedMemoryStore();
 const tool=verifiedMemoryTool({agent,store,owner:()=> 'owner',consent:{enabled:async()=>true}});
 const result=await tool.execute({...args,usage_summary:'该费率记忆可能帮助预留预算，避免遗漏手续费；尚未核实。'},{agent});
 assert.equal(result.recorded,true);assert.equal(result.status,'actor_reported_helpfulness');
 assert.equal((await store.list('owner',session.id))[0].usage_source,'actor_reported_helpfulness');
});
