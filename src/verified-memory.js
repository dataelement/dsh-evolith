import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {sessionEvents} from './session-events.js';
import {messageText} from './episode.js';

export const VERIFIED_MEMORY_TOOL='evolith_record_verified_memory';
export const VERIFIED_MEMORY_INSTRUCTION=`MEMORY VERIFICATION POLICY. Purpose: keep the memory store's quality signal accurate in both directions — record when a memory was genuinely relied on and independently checked, and abstain when it was merely visible.

"Used" means a claim from an injected memory appears in, or materially shapes, your final answer. Record when the claim is used AND it has been re-checked against a source independent of the memory text: a fresh tool result (file, URL, query) or explicit user confirmation.

Do NOT record when: the claim was never used in the answer; the only support is retrieval itself, plausibility, your own earlier answer, another memory, or historical positive-rate statistics; or the re-check contradicts the memory — state the discrepancy in the answer instead.

Independence rule: re-reading a primary source (paper, file, database) counts as independent evidence even if it was consulted in an earlier turn; restating your own prior output does not.

When recording, call ${VERIFIED_MEMORY_TOOL} before your final answer. Supply the exact memory ID and a quote identifying its text version, explain its actual application and verification, and quote the independent evidence. Also supply a short title, usage_summary and verification_summary in the current user's language: write for an ordinary user, summarize what the memory actually says (never use a verification status or generic placeholder as the title), use short sentences, and do not put internal IDs, code, JSON, tool names, feedback-ledger terminology or raw logs in these summaries. Keep technical details in application, verification_reason and evidence_quote. The tool records your evidence-based assessment for this conversation; it does not establish independent ground truth or submit positive memory feedback.`;
const hash=text=>createHash('sha256').update(text).digest('hex');
const normalized=text=>String(text).normalize('NFC').replace(/\s+/g,' ').trim();
function derived(session,event){return typeof session.deriveEventMessage==='function'?session.deriveEventMessage(event):event.data?.message||event.data;}
export function injectedMemories(session){
  let turn=0;const memories=[];
  for(const event of sessionEvents(session)){
    if(event.type==='turn/start')turn=event.data.turn;
    if(event.type!=='user/message')continue;
    const message=derived(session,event);
    if(!String(message?.id||'').startsWith('dsh-interval-memory:'))continue;
    const text=messageText(message),markers=[...text.matchAll(/^\[Memory ([^\]\n]+)\]\r?\n/gm)];
    for(let i=0;i<markers.length;i++){
      const marker=markers[i],lines=text.slice(marker.index+marker[0].length,markers[i+1]?.index??text.length).trim().split(/\r?\n/);
      const provenance=[];
      while(lines.length&&(/^(Source batch:|Source task\/rounds|Feedback exposures:)/.test(lines[0])||!lines[0].trim()))provenance.push(lines.shift());
      const claim=lines.join('\n').trim();
      if(claim)memories.push({memory_id:marker[1],memory_text:claim,memory_version:hash(claim),injected_turn:turn,injected_event_seq:event.seq,provenance:provenance.filter(Boolean).join('\n')});
    }
  }
  return memories;
}
export function validateVerification(session,args){
  for(const [key,min,max] of [['title',2,70],['usage_summary',4,140],['verification_summary',4,180],['memory_id',1,300],['memory_quote',1,6000],['application',8,2000],['verification_reason',12,3000],['evidence_quote',12,6000]]){
    if(typeof args?.[key]!=='string'||args[key].trim().length<min||args[key].length>max)throw Error('Invalid '+key);
  }
  if(!['tool_result','user_confirmation'].includes(args.evidence_type))throw Error('Evidence must be a tool result or explicit user confirmation');
  const candidates=injectedMemories(session).filter(m=>m.memory_id===args.memory_id&&normalized(m.memory_text).includes(normalized(args.memory_quote)));
  const versions=new Map(candidates.map(m=>[m.memory_version,m]));
  if(versions.size!==1)throw Error(versions.size?'Memory quote is ambiguous across text versions; quote more precisely':'This memory/version was not injected into the current conversation');
  const memory=[...versions.values()][0];let turn=0,currentTurn=0;const evidence=[];
  const events=sessionEvents(session);
  const names=new Map();
  for(const e of events){
    if(e.type==='turn/start'){turn=e.data.turn;currentTurn=turn;}
    const m=derived(session,e);
    if(e.type==='assistant/message')for(const block of m?.content||[])if(block.type==='tool-call')names.set(block.id,block.name);
    const validType=args.evidence_type==='tool_result'?e.type==='tool/result':e.type==='user/message'&&m?.source?.kind==='user'&&!/^dsh-(interval-memory|window-pruned):/.test(String(m.id));
    if(!validType||!m)continue;
    const callId=m.toolCallId||m.source?.callId;
    if(m.isError||names.get(callId)===VERIFIED_MEMORY_TOOL)continue;
    const text=messageText(m);
    if(normalized(text).includes(normalized(args.evidence_quote)))evidence.push({source_kind:args.evidence_type,event_seq:e.seq,source_turn:turn,tool_call_id:callId||null,tool_name:names.get(callId)||null,quote:args.evidence_quote.trim()});
  }
  if(!evidence.length)throw Error('Quoted evidence was not found in successful tool results or user messages from this conversation');
  return {...memory,title:args.title.trim(),usage_summary:args.usage_summary.trim(),verification_summary:args.verification_summary.trim(),application:args.application.trim(),verification_reason:args.verification_reason.trim(),evidence:evidence.at(-1),verified_turn:currentTurn,verification_source:'actor_with_observed_evidence'};
}
export class VerifiedMemoryStore{
  constructor(filename){this.filename=filename;this.data={version:1,sessions:{}};this.queue=Promise.resolve();this.ready=this.load();}
  async load(){if(!this.filename)return;try{const data=JSON.parse(await readFile(this.filename,'utf8'));if(data.version!==1||typeof data.sessions!=='object'||!data.sessions)throw Error('Invalid verified-memory store');this.data=data}catch(e){if(e.code!=='ENOENT')throw e}}
  key(owner,id){return hash(owner+'\0'+id)}
  async list(owner,id){await this.ready;return structuredClone(this.data.sessions[this.key(owner,id)]||[])}
  add(owner,id,record){
    const work=this.queue.catch(()=>{}).then(async()=>{
      await this.ready;const key=this.key(owner,id),rows=structuredClone(this.data.sessions[key]||[]);
      const duplicate=rows.find(x=>x.memory_id===record.memory_id&&x.memory_version===record.memory_version&&x.evidence.event_seq===record.evidence.event_seq&&x.verified_turn===record.verified_turn&&x.application===record.application&&x.verification_reason===record.verification_reason&&x.evidence.quote===record.evidence.quote);
      if(duplicate)return duplicate;
      const saved={...record,id:randomUUID(),recorded_at:new Date().toISOString()};rows.push(saved);
      const next={...this.data,sessions:{...this.data.sessions,[key]:rows}};
      if(this.filename){await mkdir(dirname(this.filename),{recursive:true,mode:0o700});const temporary=this.filename+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,this.filename)}
      this.data=next;return structuredClone(saved);
    });this.queue=work;return work;
  }
}
export function verifiedMemoryTool({agent,consent,store,owner}){
  return {name:VERIFIED_MEMORY_TOOL,description:VERIFIED_MEMORY_INSTRUCTION,
    parameters:{type:'object',additionalProperties:false,properties:{
      title:{type:'string',description:'Summarize the actual memory claim as a short title in the user’s language; never use a generic verification-status title. No internal memory ID or code.',minLength:2,maxLength:70},
      usage_summary:{type:'string',description:'In one short everyday-language sentence, how this memory helped the user. No jargon, JSON, logs or tool names.',minLength:4,maxLength:140},
      verification_summary:{type:'string',description:'In one short everyday-language sentence, how you checked it. No jargon, JSON, logs or tool names.',minLength:4,maxLength:180},
      memory_id:{type:'string',description:'Exact ID in [Memory ID] of an injected memory'},
      memory_quote:{type:'string',description:'Exact quote identifying the memory text version actually used'},
      application:{type:'string',description:'How you actually applied this memory in the current work',minLength:8,maxLength:2000},
      verification_reason:{type:'string',description:'Explain how the independent evidence supports this memory in this situation',minLength:12,maxLength:3000},
      evidence_type:{type:'string',enum:['tool_result','user_confirmation']},
      evidence_quote:{type:'string',description:'Exact quote from a successful tool result or explicit user confirmation in this conversation. Self assertion and other memories are not evidence.',minLength:12,maxLength:6000}
    },required:['title','usage_summary','verification_summary','memory_id','memory_quote','application','verification_reason','evidence_type','evidence_quote']},
    output:{schema:{type:'object',properties:{recorded:{type:'boolean'},record_id:{type:'string'},memory_id:{type:'string'},status:{type:'string'}},required:['recorded','record_id','memory_id','status'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){
      if(exec?.agent&&exec.agent!==agent)throw Error('Cannot record memory use for a different conversation');
      if(!await consent.enabled(String(agent.session.id)))throw Error('Evolith is disabled for this conversation');
      const account=owner(),record=validateVerification(agent.session,args);
      if(!await consent.enabled(String(agent.session.id))||owner()!==account)throw Error('Evolith connection changed during verification');
      const saved=await store.add(account,String(agent.session.id),record);
      return {recorded:true,record_id:saved.id,memory_id:saved.memory_id,status:'actor_verified_with_evidence'};
    }};
}
