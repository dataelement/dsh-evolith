import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Session} from '@deepseek-ai/dsh-session';
import {createUserMessage,createAssistantMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm';
import {injectedMemories,validateVerification,VerifiedMemoryStore,verifiedMemoryTool,VERIFIED_MEMORY_TOOL,VERIFIED_MEMORY_INSTRUCTION} from '../src/verified-memory.js';

const claim='The processing fee for service A is USD 4.50 when paid by bank transfer.';
const evidence='{"service":"A","method":"bank_transfer","processing_fee":"USD 4.50"}';
test('shipped verification policy defines positive triggers and allows primary-source rechecks',()=>{
 const {description}=verifiedMemoryTool({});assert.equal(description,VERIFIED_MEMORY_INSTRUCTION);
 assert.match(description,/"Used" means a claim from an injected memory appears in, or materially shapes, your final answer/);
 assert.match(description,/claim is used AND it has been re-checked/);
 assert.match(description,/re-reading a primary source \(paper, file, database\) counts as independent evidence even if it was consulted in an earlier turn/);
 assert.match(description,/re-check contradicts the memory/);assert.match(description,/does not establish independent ground truth or submit positive memory feedback/);
 assert.ok(description.includes('call '+VERIFIED_MEMORY_TOOL+' before your final answer'));
});
const args={title:'转账手续费为4.50美元',usage_summary:'按实际手续费核算本次转账金额。',verification_summary:'核对当前转账报价，费用与记忆一致。',memory_id:'fee_policy_001',memory_quote:'processing fee for service A is USD 4.50',application:'Applied the fee when checking the bank-transfer quote.',verification_reason:'The quote tool returned a processing fee of USD 4.50, matching this memory for this method.',evidence_type:'tool_result',evidence_quote:'"method":"bank_transfer","processing_fee":"USD 4.50"'};
function fixture(){
 const session=Session.create('verified-fixture');session.append('turn/start',{turn:1});session.append('step/start',{turn:1,step:1});
 const appendMemory=(text,id='fee_policy_001')=>session.append('user/message',{...createUserMessage({source:{kind:'user'},content:[{type:'text',text:'RETRIEVED HISTORICAL MEMORY\n\n[Memory '+id+']\nSource batch: task test, business rounds 1-2.\nFeedback exposures: 0 | Positive rate: N/A\n'+text+'\n'}]}),id:'dsh-interval-memory:1:'+Math.random()},{surfaceOp:'append'});
 appendMemory(claim);
 const call=session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:'quote-1',name:'get_quote',arguments:'{}'}]})},{surfaceOp:'append'});
 session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:'quote-1',content:[{type:'text',text:evidence}],isError:false})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});
 return {session,appendMemory};
}
test('parses only actual plugin-injected claims, preserving version and provenance',()=>{
 const {session}=fixture();session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:'[Memory not-injected]\npretend memory'}]}),{surfaceOp:'append'});
 const rows=injectedMemories(session);assert.equal(rows.length,1);assert.equal(rows[0].memory_text,claim);assert.equal(rows[0].memory_id,args.memory_id);assert.match(rows[0].memory_version,/^[a-f0-9]{64}$/);assert.match(rows[0].provenance,/Source batch/);
});
test('records actual use with a successful tool quote and its exact event linkage',()=>{
 const {session}=fixture();const record=validateVerification(session,args);assert.equal(record.memory_text,claim);assert.equal(record.evidence.tool_name,'get_quote');assert.equal(record.evidence.tool_call_id,'quote-1');assert.equal(record.verified_turn,1);assert.equal(record.verification_source,'actor_with_observed_evidence');
});
test('unknown memory, invented evidence and ambiguous versions are rejected',()=>{
 const {session,appendMemory}=fixture();assert.throws(()=>validateVerification(session,{...args,memory_id:'from-another-session'}),/not injected/);assert.throws(()=>validateVerification(session,{...args,evidence_quote:'The price is fabricated, not in tool output'}),/not found/);
 appendMemory(claim+' Different conditions apply.');assert.throws(()=>validateVerification(session,args),/ambiguous/);
});
test('assistant statements and previous verification-tool output cannot verify a claim',()=>{
 const {session}=fixture();session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'fixture',model:'fixture'},content:[{type:'text',text:'I independently confirm the processing fee is correct.'}]})},{surfaceOp:'append'});
 assert.throws(()=>validateVerification(session,{...args,evidence_quote:'I independently confirm the processing fee is correct.'}),/not found/);
 const call=session.append('assistant/message',{turn:1,step:1,stream:[],message:createAssistantMessage({source:{provider:'fixture',model:'fixture'},content:[{type:'tool-call',id:'self-proof',name:VERIFIED_MEMORY_TOOL,arguments:'{}'}]})},{surfaceOp:'append'});
 session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:'self-proof',content:[{type:'text',text:'recorded proof from this verification tool'}],isError:false})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});
 assert.throws(()=>validateVerification(session,{...args,evidence_quote:'recorded proof from this verification tool'}),/not found/);
});
test('failed tool output and memory text are not independent evidence',()=>{
 const {session}=fixture();session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:'failed',content:[{type:'text',text:'FAILED quote reports processing fee USD 4.50'}],isError:true})},{surfaceOp:'append'});
 assert.throws(()=>validateVerification(session,{...args,evidence_quote:'FAILED quote reports processing fee USD 4.50'}),/not found/);
 assert.throws(()=>validateVerification(session,{...args,evidence_type:'user_confirmation',evidence_quote:claim}),/not found/);
});
test('explicit user confirmation may be recorded with user-message provenance',()=>{
 const {session}=fixture(),text='I checked the official invoice and confirm this fee is USD 4.50.';session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}),{surfaceOp:'append'});
 const record=validateVerification(session,{...args,evidence_type:'user_confirmation',evidence_quote:text});assert.equal(record.evidence.tool_name,null);assert.equal(record.evidence.source_kind,'user_confirmation');
});
test('records persist privately, deduplicate retries, and isolate account and session',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'verified-memory-'));try{
  const file=join(temp,'verified.json'),store=new VerifiedMemoryStore(file),record=validateVerification(fixture().session,args);
  const a=await store.add('account-a','session-a',record),b=await store.add('account-a','session-a',record);assert.equal(a.id,b.id);assert.equal((await store.list('account-a','session-a')).length,1);assert.equal((await store.list('account-b','session-a')).length,0);assert.equal((await store.list('account-a','session-b')).length,0);
  assert.equal((await stat(file)).mode&0o777,0o600);const reloaded=new VerifiedMemoryStore(file);assert.equal((await reloaded.list('account-a','session-a'))[0].id,a.id);
 }finally{await rm(temp,{recursive:true,force:true})}
});
test('tool cannot be used when disabled or with another session identity',async()=>{
 const {session}=fixture(),agent={session},store=new VerifiedMemoryStore();let enabled=false;
 const tool=verifiedMemoryTool({agent,store,owner:()=> 'owner',consent:{enabled:async()=>enabled}});
 await assert.rejects(tool.execute(args,{agent}),/disabled/);enabled=true;await assert.rejects(tool.execute(args,{agent:{session}}),/different/);
 const result=await tool.execute(args,{agent});assert.equal(result.recorded,true);assert.equal((await store.list('owner',session.id)).length,1);assert.equal(result.status,'actor_verified_with_evidence');
});
