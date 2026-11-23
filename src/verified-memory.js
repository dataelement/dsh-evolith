import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {sessionEvents} from './session-events.js';
import {messageText} from './episode.js';

export const VERIFIED_MEMORY_TOOL='evolith_record_verified_memory';
export const VERIFIED_MEMORY_INSTRUCTION=`MEMORY USE REPORTING POLICY. Record only an injected memory that you actually used and that provided a concrete benefit in the current work: it helped avoid a specific potential mistake, or saved a repeated query, file read, or search.

Call ${VERIFIED_MEMORY_TOOL} before your final answer when either benefit applies. Supply exactly four fields: memory_id, title, usage_summary, benefit_type. Use the exact ID from [Memory ID]. The program resolves the latest version of that ID actually injected into this conversation and saves its text and provenance; do not reproduce the memory or supply evidence fields.

Choose benefit_type explicitly: "avoid_error" means this memory helped avoid a specific potential mistake; "save_tool_calls" means you actually skipped a repeated lookup, search, or file read by reusing the memory; "both" means both benefits occurred. Mere reuse of information does not establish a saved tool call. If you performed the same lookup anyway, do not count that lookup as saved. The UI uses this field directly, without interpreting your prose. If neither benefit applies, do not call the tool.

Write title and usage_summary in the current user's language, using short everyday sentences. The title summarizes what the memory says, never a generic status such as "verified". In usage_summary, explain specifically either (1) what possible mistake the memory helped you avoid and how, or (2) which repeated lookup it saved and which information was reused. If both apply, mention both. Avoid vague phrases such as "used this memory" or "improved efficiency". Do not invent an error that actually happened, a measured time saving, or a verification you did not perform. Do not perform an extra query solely to report memory use.

Do NOT record a memory merely because it was retrieved or visible, when it did not affect your work, or when current evidence contradicts it. Current instructions and current tool results take precedence over historical memory. This tool records the actor's account of useful memory use, not independent verification, ground-truth correctness, or positive memory feedback.`;
const hash=text=>createHash('sha256').update(text).digest('hex');
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
  const allowed=['memory_id','title','usage_summary','benefit_type'];
  if(!args||Object.keys(args).some(key=>!allowed.includes(key)))throw Error('Only memory_id, title, usage_summary and benefit_type are accepted');
  for(const [key,min,max] of [['title',2,70],['usage_summary',4,300],['memory_id',1,300]]){
    if(typeof args[key]!=='string'||args[key].trim().length<min||args[key].length>max)throw Error('Invalid '+key);
  }
  if (!["avoid_error","save_tool_calls","both"].includes(args.benefit_type)) throw Error("Invalid benefit_type");
  // The actor supplies only an ID. Resolve the latest actually delivered text,
  // never a newer server revision that the actor did not see.
  const candidates=injectedMemories(session).filter(m=>m.memory_id===args.memory_id);
  const memory=candidates.at(-1);
  if(!memory)throw Error('This memory was not injected into the current conversation');
  let turn=0;for(const event of sessionEvents(session))if(event.type==='turn/start')turn=event.data.turn;
  return {...memory,title:args.title.trim(),usage_summary:args.usage_summary.trim(),benefit_type:args.benefit_type,used_turn:turn,usage_source:'actor_reported_use'};
}
export class VerifiedMemoryStore{
  constructor(filename){this.filename=filename;this.data={version:1,sessions:{}};this.queue=Promise.resolve();this.ready=this.load();}
  async load(){if(!this.filename)return;try{const data=JSON.parse(await readFile(this.filename,'utf8'));if(data.version!==1||typeof data.sessions!=='object'||!data.sessions)throw Error('Invalid verified-memory store');this.data=data}catch(e){if(e.code!=='ENOENT')throw e}}
  key(owner,id){return hash(owner+'\0'+id)}
  async list(owner,id){await this.ready;return structuredClone(this.data.sessions[this.key(owner,id)]||[])}
  add(owner,id,record){
    const work=this.queue.catch(()=>{}).then(async()=>{
      await this.ready;const key=this.key(owner,id),rows=structuredClone(this.data.sessions[key]||[]);
      const duplicate=rows.find(x=>x.memory_id===record.memory_id&&x.memory_version===record.memory_version&&x.used_turn===record.used_turn&&x.title===record.title&&x.usage_summary===record.usage_summary&&x.benefit_type===record.benefit_type&&x.usage_source===record.usage_source);
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
      memory_id:{type:'string',description:'Exact ID in [Memory ID] of an injected memory; program resolves its actual delivered content.',minLength:1,maxLength:300},
      title:{type:'string',description:'Short title summarizing the actual memory claim in the user’s language, not a verification status.',minLength:2,maxLength:70},
      benefit_type:{type:'string',enum:['avoid_error','save_tool_calls','both'],description:'Choose avoid_error for a concrete potential mistake avoided; save_tool_calls for a repeated lookup/read/search actually skipped; both only if both apply. Do not count a lookup you performed anyway as saved.'},
      usage_summary:{type:'string',description:'Explain in plain language what specific potential mistake the memory helped avoid, or which repeated lookup/search/read it saved. Specify the mistake or reused information. Do not invent measured time savings.',minLength:4,maxLength:300}
    },required:['memory_id','title','usage_summary','benefit_type']},
    output:{schema:{type:'object',properties:{recorded:{type:'boolean'},record_id:{type:'string'},memory_id:{type:'string'},status:{type:'string'},benefit_type:{type:'string',enum:['avoid_error','save_tool_calls','both']}},required:['recorded','record_id','memory_id','status','benefit_type'],additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){
      if(exec?.agent&&exec.agent!==agent)throw Error('Cannot record memory use for a different conversation');
      if(!await consent.enabled(String(agent.session.id)))throw Error('Evolith is disabled for this conversation');
      const account=owner(),record=validateVerification(agent.session,args);
      if(!await consent.enabled(String(agent.session.id))||owner()!==account)throw Error('Evolith connection changed during verification');
      const saved=await store.add(account,String(agent.session.id),record);
      return {recorded:true,record_id:saved.id,memory_id:saved.memory_id,status:'actor_reported_use',benefit_type:saved.benefit_type};
    }};
}
