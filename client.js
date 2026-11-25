window.__ModuleLoader__.load({ id: "dsh-evolith", factory: (require) => {
  let hostContext;
  const React = require("react"), h = React.createElement, API = "/dsh-memory-bridge/manager/";
  const { createPortal } = require("react-dom");
  async function api(path, method = "GET", body) {
    const r = await fetch(API + path, { method, credentials: "same-origin", cache: "no-store", headers: { "x-dsh-memory-request": "1", ...body ? { "content-type": "application/json" } : {} }, ...body ? { body: JSON.stringify(body) } : {} });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "请求失败");
    return d;
  }
  // Hide only Evolith-owned message IDs in the native Chat projection.
  // Session events and model inputs remain intact, including existing history.
  const controlStyles = `
[data-chat-node-key^="13:input-messagedsh-interval-memory:"]{display:none!important}
.dsh-evolith-control{display:inline-flex;align-items:center;gap:3px;font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary,#5b6472);white-space:nowrap;-webkit-app-region:no-drag}
.dsh-evolith-switch,.dsh-evolith-help{appearance:none;box-sizing:border-box;border:0;background:transparent;box-shadow:none;margin:0;font:inherit;color:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;min-width:0;min-height:0}
.dsh-evolith-switch{gap:7px;padding:5px 4px;font-weight:500;line-height:18px}
.dsh-evolith-switch:hover:not(:disabled),.dsh-evolith-help:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(115,126,145,.09))}
.dsh-evolith-switch:focus-visible,.dsh-evolith-help:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#3b82f6);outline-offset:2px}
.dsh-evolith-switch:disabled{cursor:default;opacity:.55}
.dsh-evolith-track{display:block;position:relative;flex:none;width:27px;height:16px;border-radius:999px;background:var(--dsw-alias-label-quaternary,#c5ccd7);transition:background 150ms ease}
.dsh-evolith-switch[aria-checked=true] .dsh-evolith-track{background:var(--dsw-alias-state-business-primary,#397af5)}
.dsh-evolith-thumb{position:absolute;left:2px;top:2px;display:block;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform 150ms ease}
.dsh-evolith-switch[aria-checked=true] .dsh-evolith-thumb{transform:translateX(11px)}
.dsh-evolith-help{width:23px;height:28px;padding:0;color:var(--dsw-alias-label-tertiary,#8b94a2);cursor:help}
.dsh-evolith-help:hover,.dsh-evolith-help[aria-expanded=true]{color:var(--dsw-alias-label-primary,#3e495b)}
.dsh-evolith-tooltip{position:fixed;z-index:2147483647;box-sizing:border-box;width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow-y:auto;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1,#e1e6ed);border-radius:12px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#283344);box-shadow:0 8px 30px #1b2b491c;font-family:inherit;font-size:13px;font-weight:400;line-height:1.65;white-space:normal;overflow-wrap:anywhere;-webkit-app-region:no-drag}
.dsh-evolith-tooltip-title{font-weight:600;font-size:13px;margin:0 0 7px}
.dsh-evolith-tooltip p{margin:0}
.dsh-evolith-privacy{margin:10px 0;padding:10px 11px;border-radius:8px;background:var(--dsw-alias-state-business-tertiary,#f0f5fe)}
.dsh-evolith-privacy strong{display:block;margin-bottom:3px;font-weight:600}
.dsh-evolith-tooltip-foot{color:var(--dsw-alias-label-secondary,#647084);font-size:12px}
.dsh-evolith-verified-panel{height:100%;box-sizing:border-box;overflow:auto;padding:20px 16px;color:var(--dsw-alias-label-primary,#27364c);background:var(--dsw-alias-bg-base,#fff);font-size:13px;line-height:1.65}
.dsh-evolith-verified-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dsh-evolith-verified-heading h2{font-size:15px;margin:0 0 3px;font-weight:600}.dsh-evolith-verified-muted,.dsh-evolith-verified-meta{color:var(--dsw-alias-label-tertiary,#7b8594);font-size:12px}
.dsh-evolith-verified-refresh{border:1px solid var(--dsw-alias-border-l1,#e1e6ed);border-radius:7px;background:transparent;color:inherit;font:inherit;padding:3px 9px;cursor:pointer}.dsh-evolith-verified-explanation{color:var(--dsw-alias-label-secondary,#647084);font-size:12px;margin:14px 0 18px}.dsh-evolith-verified-empty{border:1px dashed var(--dsw-alias-border-l1,#e1e6ed);border-radius:10px;padding:18px 14px;margin-top:20px}.dsh-evolith-verified-empty p{font-size:12px;color:var(--dsw-alias-label-secondary,#647084)}
.dsh-evolith-verified-card{border:1px solid var(--dsw-alias-border-l1,#e1e6ed);border-radius:10px;padding:16px;margin:12px 0;overflow-wrap:anywhere}.dsh-evolith-verified-status{display:flex;align-items:center;gap:6px;color:#168058;font-size:11px;font-weight:500}.dsh-evolith-verified-round{margin-left:auto;color:var(--dsw-alias-label-tertiary,#7b8594);font-weight:400}.dsh-evolith-verified-eyebrow{font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8594);margin-top:12px}.dsh-evolith-verified-title{font-size:15px;line-height:1.6;font-weight:600;margin:3px 0 13px;color:var(--dsw-alias-label-primary,#27364c)}.dsh-evolith-verified-summary{padding:0 0 0 10px;border-left:2px solid var(--dsw-alias-border-l1,#dce5f2)}.dsh-evolith-verified-summary strong{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary,#647084)}.dsh-evolith-verified-summary p{margin:4px 0;font-size:13px;line-height:1.65;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.dsh-evolith-verified-details{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1,#e1e6ed);padding-top:10px;font-size:12px}.dsh-evolith-verified-details summary{cursor:pointer;color:var(--dsw-alias-label-tertiary,#7b8594)}.dsh-evolith-verified-details pre{white-space:pre-wrap;max-height:180px;overflow:auto;background:var(--dsw-alias-state-business-tertiary,#f0f5fe);padding:9px;border-radius:6px;font-size:11px}.dsh-evolith-verified-card-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dsh-evolith-verified-card-title strong{font-size:12px;font-weight:600}.dsh-evolith-verified-badge{font-size:11px;background:#e8f6ef;color:#16734c;border-radius:5px;padding:1px 6px;white-space:nowrap}.dsh-evolith-verified-meta{margin-top:5px}.dsh-evolith-verified-card dl{margin:12px 0 0}.dsh-evolith-verified-card dt{font-size:12px;color:var(--dsw-alias-label-secondary,#647084);margin-top:9px}.dsh-evolith-verified-card dd{margin:3px 0 0}.dsh-evolith-verified-card blockquote{margin:5px 0;padding:7px 10px;border-left:2px solid #75a5ef;background:var(--dsw-alias-state-business-tertiary,#f0f5fe);white-space:pre-wrap}.dsh-evolith-verified-original{font-size:12px;margin-top:10px}.dsh-evolith-verified-original summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#647084)}.dsh-evolith-verified-original p{white-space:pre-wrap}.dsh-evolith-verified-error{color:#b42318}
.dsh-evolith-buffs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 14px}.dsh-evolith-buff{display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;padding:6px 10px;border:1px solid;border-radius:8px;font-size:12px;font-weight:600;line-height:1.35;box-shadow:none}.dsh-evolith-buff-icon{display:grid;place-items:center;width:21px;height:21px;flex:none;background:transparent;box-shadow:none}.dsh-evolith-buff--avoid{color:#316bc8;border-color:#d8e6fa;background:#f0f6ff}.dsh-evolith-buff--save{color:#a76c13;border-color:#f1dfb8;background:#fff8e9}
.dsh-evolith-benefit-trigger{width:28px;height:28px;min-width:28px;gap:0;cursor:pointer}.dsh-evolith-turn-buff-anchor{display:inline-flex;align-items:center;flex:none}.dsh-evolith-benefit-trigger--active{padding:0;border-radius:6px}.dsh-evolith-trigger-icon{display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:0;background:transparent;box-shadow:none}.dsh-evolith-trigger-icon--avoid{color:#397af5}.dsh-evolith-trigger-icon--save{color:#bc811b}.dsh-evolith-trigger-icon--both{color:#4e74d4}
@media(prefers-reduced-motion:reduce){.dsh-evolith-track,.dsh-evolith-thumb{transition:none}}
`;
  const verificationKind='evolith-verified-memory', verificationTab='dsh-memory-bridge-profile.verified-memory';
  const selectedMemoryTurns=new Map(),memoryTurnListeners=new Set();
  function openVerifications(sessionId,turn=null){
    const side=hostContext?.get?.('sidebarRight'),tabs=hostContext?.get?.('sidebarRightTabs');
    if(!sessionId||!tabs?.get(verificationKind)||!side?.openTabIn)return;
    selectedMemoryTurns.set(sessionId,Number.isInteger(turn)&&turn>0?turn:null);
    for(const listener of memoryTurnListeners)listener(sessionId);
    side.openTabIn(sessionId,verificationKind,{revealIfOpened:true});
  }
  const openedVerificationTurns=new Set();
  function watchVerificationResults(source,onVerified,onBenefit){
    const calls=new Map(),seen=new Set();let currentTurn=0,turnOpen=false;
    const observe=(event,notify)=>{
      const eventTurn=event.data?.turn;
      if(Number.isInteger(eventTurn)&&eventTurn>currentTurn){currentTurn=eventTurn;turnOpen=true;}
      if(event.type==='turn/start'){currentTurn=eventTurn;turnOpen=true;}
      if(event.type==='turn/end'&&event.data?.turn===currentTurn)turnOpen=false;
      const message=event.data?.message||event.data;
      if(event.type==='assistant/message')for(const block of message?.content||[])if(block.type==='tool-call')calls.set(block.id,block.name);
      if(event.type!=='tool/result'||seen.has(event.seq))return;
      seen.add(event.seq);
      if(message?.isError)return;
      if(calls.get(message?.toolCallId||message?.source?.callId)!=='evolith_record_verified_memory')return;
      try{
        const result=JSON.parse((message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
        if(result.recorded===true&&['actor_reported_helpfulness','actor_reported_use','actor_verified_with_evidence'].includes(result.status)&&typeof result.record_id==='string'){
          onBenefit?.(memoryBenefits(result));
          if(notify&&turnOpen&&event.data?.turn===currentTurn)onVerified(currentTurn);
        }
      }catch{}
    };
    for(const entry of source.getSnapshot().entries||[])observe(entry.event,false);
    return source.subscribe(()=>{
      const {change}=source.getSnapshot();
      if(change?.kind==='append')for(const entry of change.entries||[])observe(entry.event,true);
      else if(change?.kind==='settle-assistant'&&change.entry)observe(change.entry.event,false);
      else if(change?.kind==='replace'||change?.kind==='prepend'){currentTurn=0;turnOpen=false;for(const entry of source.getSnapshot().entries||[])observe(entry.event,false);}
    });
  }
  function memoryBenefits(record){
    return {avoid:record.benefit_type==='avoid_error'||record.benefit_type==='both',save:record.benefit_type==='save_tool_calls'||record.benefit_type==='both'};
  }
  // Lucide shield-check/zap paths, ISC license in THIRD_PARTY_NOTICES.md.
  function benefitGlyph(kind,size){
    return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
      kind==='save'?h('path',{d:"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"}):h('path',{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"}),
      kind==='avoid'?h('path',{d:"m9 12 2 2 4-4"}):kind==='both'?h('path',{d:'m13 7-4 5.5h3l-1 4.5 4.5-6H12Z',fill:'#bc811b',stroke:'none'}):null);
  }
  function benefitBadge(kind){
    const avoid=kind==='avoid',label=avoid?'避免问题':'节省调用';
    return h('span',{className:'dsh-evolith-buff dsh-evolith-buff--'+kind,role:'img','aria-label':label+' BUFF',title:'根据助手选择的收益类型标注，不代表独立验证或实际调用次数测量'},
      h('span',{className:'dsh-evolith-buff-icon','aria-hidden':true},benefitGlyph(kind,19)),h('span',null,label));
  }
  function memoryCardCopy(record){
    const original=(record.memory_text||'').trim();
    const feedbackMissing=/No evaluator feedback supplied/i.test(original);
    const taskContinues=/Business dialogue batch boundary; task remains unfinished/i.test(original);
    const suppliedTitle=(record.title||'').trim();
    const title=suppliedTitle&&!['这条记忆已核实','尚未收到反馈'].includes(suppliedTitle)?suppliedTitle:
      feedbackMissing?'当时没有提供评测反馈':taskContinues?'当时任务尚未完成，仍需继续处理':original.replace(/^(observation|agent_final_output|fact|policy):\s*/i,'')||'记忆原文未保存';
    return {
      title,
      usage:record.usage_summary||(feedbackMissing&&record.application?'汇总时按“没有反馈”处理，未将其当作用户认可。':taskContinues&&record.application?'判断工作仍在进行，继续处理后续请求。':record.application||''),
      legacy:!suppliedTitle
    };
  }
  function VerifiedMemories({sessionId}={}){
    const [data,setData]=React.useState({sessionId,records:[]}),[error,setError]=React.useState(''),[loading,setLoading]=React.useState(true);
    const [selection,setSelection]=React.useState({sessionId,turn:selectedMemoryTurns.get(sessionId)??null});
    const selectedTurn=selection.sessionId===sessionId?selection.turn:selectedMemoryTurns.get(sessionId)??null;
    React.useEffect(()=>{
      const update=id=>{if(id===sessionId)setSelection({sessionId,turn:selectedMemoryTurns.get(sessionId)??null})};
      update(sessionId);memoryTurnListeners.add(update);return()=>memoryTurnListeners.delete(update);
    },[sessionId]);
    const current=React.useRef(sessionId);current.current=sessionId;
    async function refresh(){const id=sessionId;try{const d=await api('verified-memory?session_id='+encodeURIComponent(id));if(current.current===id){setData({...d,sessionId:id});setError('');setLoading(false)}}catch(e){if(current.current===id){setError(e.message);setLoading(false)}}}
    React.useEffect(()=>{
      let live=true;setData({sessionId,records:[]});setError('');setLoading(true);
      if(!sessionId){setLoading(false);return}
      const load=async()=>{try{const d=await api('verified-memory?session_id='+encodeURIComponent(sessionId));if(live){setData({...d,sessionId});setError('');setLoading(false)}}catch(e){if(live){setError(e.message);setLoading(false)}}};
      load();const timer=setInterval(load,2000);return()=>{live=false;clearInterval(timer)};
    },[sessionId,selectedTurn]);
    const records=(data.sessionId===sessionId?data.records||[]:[]).filter(record=>selectedTurn===null||(record.used_turn??record.verified_turn)===selectedTurn);
    return h('section',{className:'dsh-evolith-verified-panel','aria-label':selectedTurn===null?'当前对话使用的记忆':'第'+selectedTurn+'轮使用的记忆'},
      h('div',{className:'dsh-evolith-verified-heading'},h('div',null,h('h2',null,selectedTurn===null?'本次用到的记忆':'第'+selectedTurn+'轮用到的记忆'),h('span',{className:'dsh-evolith-verified-muted'},(selectedTurn===null?'当前对话':'对应本轮回复')+' · '+records.length+'条记录')),h('button',{type:'button',className:'dsh-evolith-verified-refresh',onClick:refresh},'刷新')),
      h('p',{className:'dsh-evolith-verified-explanation'},'这里展示助手标记为可能有帮助的记忆，例如规避风险或减少重复查询。'),
      data.enabled===false?h('p',{className:'dsh-evolith-verified-muted'},'本会话已关闭 Evolith，保留此前的使用记录。'):null,
      error?h('p',{role:'alert',className:'dsh-evolith-verified-error'},'读取失败：'+error):null,
      loading?h('p',{role:'status',className:'dsh-evolith-verified-muted'},'正在读取…'):null,
      !loading&&!error&&!records.length?h('div',{className:'dsh-evolith-verified-empty'},h('strong',null,selectedTurn===null?'暂时没有记忆使用记录':'本轮没有记忆使用记录'),h('p',null,'助手发现记忆可能帮助当前任务时，会标记在这里，无需先验证。')):null,
      ...records.slice().reverse().map(record=>{const copy=memoryCardCopy(record),benefits=memoryBenefits(record);return h('article',{key:record.id,className:'dsh-evolith-verified-card'},
        h('div',{className:'dsh-evolith-verified-status'},h('span',{'aria-hidden':true},'✓'),h('span',null,record.usage_source==='actor_reported_helpfulness'?'可能有帮助':record.usage_source==='actor_reported_use'?'已使用':'已使用 · 已核实'),h('span',{className:'dsh-evolith-verified-round'},'第'+(record.used_turn??record.verified_turn)+'轮')),
        (benefits.avoid||benefits.save)?h('div',{className:'dsh-evolith-buffs'},benefits.avoid?benefitBadge('avoid'):null,benefits.save?benefitBadge('save'):null):null,
        h('div',{className:'dsh-evolith-verified-eyebrow'},'记忆内容'),
        h('h3',{className:'dsh-evolith-verified-title'},copy.title),
        h('div',{className:'dsh-evolith-verified-summary'},h('strong',null,'本次用途'),h('p',null,copy.usage)),
        h('details',{className:'dsh-evolith-verified-details'},h('summary',null,['actor_reported_helpfulness','actor_reported_use'].includes(record.usage_source)?'查看记忆原文与来源':'查看原文与证据'),
          h('dl',null,h('dt',null,'记忆原文'),h('dd',null,record.memory_text),record.application?h('dt',null,'使用详情'):null,record.application?h('dd',null,record.application):null,record.verification_reason?h('dt',null,'核实说明'):null,record.verification_reason?h('dd',null,record.verification_reason):null,record.evidence?h('dt',null,'证据原文'):null,record.evidence?h('dd',null,h('pre',null,record.evidence.quote),h('span',{className:'dsh-evolith-verified-muted'},'第'+record.evidence.source_turn+'轮 · '+(record.evidence.tool_name||'用户消息'))):null,h('dt',null,'记忆编号与来源'),h('dd',null,h('code',null,record.memory_id),h('p',null,record.provenance||'来源未标注'),h('code',null,record.memory_version?.slice(0,12))))));}),
      records.length?h('p',{className:'dsh-evolith-verified-muted'},'标记表示助手判断可能有帮助，不代表已核实或收益已经发生。'):null);
  }
  function assistantMessageTurn(source,messageId){
    if(!source?.getSnapshot||!messageId)return null;
    let turn=null;
    for(const {event} of source.getSnapshot().entries||[]){
      if(event.type==='turn/start'&&Number.isInteger(event.data?.turn))turn=event.data.turn;
      if(event.type!=='assistant/message')continue;
      const message=event.data?.message||event.data;
      if(message?.id===messageId){
        const value=event.data?.turn??turn;
        return Number.isInteger(value)&&value>0?value:null;
      }
    }
    return null;
  }
  function TurnMemoryBuff({sessionId,messageId}={}){
    const [view,setView]=React.useState({sessionId:null,messageId:null,turn:null,records:[]});
    const [target,setTarget]=React.useState(null),marker=React.useRef(null);
    React.useEffect(()=>{
      let live=true,request=0;
      const source=hostContext?.get?.('sessions')?.binding?.(sessionId)?.eventSource;
      let knownTurn=assistantMessageTurn(source,messageId);
      setView({sessionId,messageId,turn:knownTurn,records:[]});
      const load=async()=>{
        const turn=assistantMessageTurn(source,messageId),version=++request;
        if(turn===null)return;
        try{
          const data=await api('verified-memory?session_id='+encodeURIComponent(sessionId));
          if(live&&version===request)setView({sessionId,messageId,turn,records:(data.records||[]).filter(record=>(record.used_turn??record.verified_turn)===turn)});
        }catch{if(live&&version===request)setView({sessionId,messageId,turn,records:[]})}
      };
      if(sessionId&&knownTurn!==null)load();
      const disposeResults=source?.subscribe&&source?.getSnapshot?watchVerificationResults(source,turn=>{
        if(turn===assistantMessageTurn(source,messageId))load();
      }):undefined;
      const disposeTurn=source?.subscribe?.(()=>{
        const next=assistantMessageTurn(source,messageId);
        if(next!==knownTurn){knownTurn=next;setView({sessionId,messageId,turn:next,records:[]});if(next!==null)load();}
      });
      return()=>{live=false;disposeResults?.();disposeTurn?.()};
    },[sessionId,messageId]);
    const current=view.sessionId===sessionId&&view.messageId===messageId?view:{turn:null,records:[]};
    const benefits=current.records.reduce((value,record)=>{const next=memoryBenefits(record);return{avoid:value.avoid||next.avoid,save:value.save||next.save}},{avoid:false,save:false});
    const kind=benefits.avoid&&benefits.save?'both':benefits.avoid?'avoid':benefits.save?'save':null;
    React.useLayoutEffect(()=>{
      if(!kind)return;
      // DSH's assistant-actions slot is before Branch. Its native [data-clock=end]
      // row ends with usage/time. Mount a portal immediately before that end-info
      // element, placing this button after Branch in both DOM and keyboard order.
      const row=marker.current?.closest?.('[data-clock="end"]'),endInfo=row?.lastElementChild;
      if(!row||!endInfo||endInfo===marker.current)return;
      const anchor=document.createElement('span');anchor.className='dsh-evolith-turn-buff-anchor';
      row.insertBefore(anchor,endInfo);setTarget(anchor);
      return()=>{setTarget(null);anchor.remove()};
    },[sessionId,messageId,Boolean(kind)]);
    const label='查看第'+current.turn+'轮用到的记忆';
    return h(React.Fragment,null,h('span',{ref:marker,hidden:true,'data-evolith-turn-marker':messageId}),
      target&&kind?createPortal(h('button',{type:'button',className:'dsh-evolith-help dsh-evolith-benefit-trigger dsh-evolith-benefit-trigger--active','aria-label':label,title:'第'+current.turn+'轮 · '+[benefits.avoid?'避免问题':null,benefits.save?'节省调用':null].filter(Boolean).join('、')+' · '+current.records.length+'条记忆',onClick:()=>openVerifications(sessionId,current.turn)},
        h('span',{className:'dsh-evolith-trigger-icon dsh-evolith-trigger-icon--'+kind,role:'img','aria-label':benefits.avoid&&benefits.save?'已触发避免问题和节省调用':benefits.avoid?'已触发避免问题':'已触发节省调用'},benefitGlyph(kind,20))),target):null);
  }
  const quotaMessages = {
    account: "额度不足，暂停生成新记忆",
    pool: "本轮公司记忆额度已用完",
    paused: "新记忆处理暂时暂停",
    request: "本次记忆处理超过模型计量范围"
  };
  function Toggle({ sessionId } = {}) {
    const [enabled, setEnabled] = React.useState(true);
    const [busy, setBusy] = React.useState(true);
    const [error, setError] = React.useState("");
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const [quota, setQuota] = React.useState(null);
    const help = React.useRef(null), tip = React.useRef(null), hideTimer = React.useRef(null);
    const hovered = React.useRef(false), focused = React.useRef(false);
    const currentSession = React.useRef(sessionId);
    currentSession.current = sessionId;
    const tooltipId = React.useId();
    const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
    const showHelp = () => { cancelHide(); setOpen(true); };
    const hideHelp = () => {
      cancelHide();
      if (hovered.current || focused.current) return;
      hideTimer.current = setTimeout(() => { if (!hovered.current && !focused.current) setOpen(false); }, 120);
    };
    const pointerEnter = () => { hovered.current = true; showHelp(); };
    const pointerLeave = () => { hovered.current = false; hideHelp(); };
    const focusEnter = () => { focused.current = true; showHelp(); };
    const focusLeave = () => { focused.current = false; hideHelp(); };
    React.useEffect(() => {
      let live = true;
      setBusy(true); setEnabled(false); setError(""); setOpen(false); setQuota(null);
      if (!sessionId) { setBusy(false); return () => { live = false; }; }
      api("evolith?session_id=" + encodeURIComponent(sessionId)).then(d => {
        if (live) { setEnabled(d.enabled === true); setQuota(d); }
      }).catch(e => { if (live) setError(e.message); })
        .finally(() => { if (live) setBusy(false); });
      return () => { live = false; cancelHide(); };
    }, [sessionId]);
    React.useEffect(() => {
      if (!enabled || !sessionId) return;
      let active = true;
      const id = encodeURIComponent(sessionId);
      const refresh = () => api("evolith?session_id=" + id).then(d => { if (active) setQuota(d); }).catch(() => {});
      const source = hostContext?.get?.("sessions")?.binding?.(sessionId)?.eventSource;
      const dispose = source?.getSnapshot && source?.subscribe ? source.subscribe(() => {
        const {change} = source.getSnapshot();
        if (change?.kind === "append" && change.entries?.some(({event}) => event.type === "turn/end")) void refresh();
      }) : undefined;
      return () => { active = false; dispose?.(); };
    }, [enabled, sessionId]);
    React.useEffect(()=>{
      let live=true;
      if(!enabled||!sessionId)return()=>{live=false};
      const source=hostContext?.get?.('sessions')?.binding?.(sessionId)?.eventSource;
      const dispose=source?.subscribe&&source?.getSnapshot?watchVerificationResults(source,turn=>{
        if(!live||currentSession.current!==sessionId)return;
        const key=sessionId+':'+turn;
        if(openedVerificationTurns.has(key))return;
        openedVerificationTurns.add(key);openVerifications(sessionId,turn);
      }):undefined;
      return()=>{live=false;dispose?.()};
    },[sessionId,enabled]);
    React.useLayoutEffect(() => {
      if (!open || !help.current || !tip.current) { setPosition(null); return; }
      const a = help.current.getBoundingClientRect(), t = tip.current.getBoundingClientRect();
      const left = Math.max(12, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 12));
      const top = a.top - t.height - 10 >= 12 ? a.top - t.height - 10 : Math.max(12, Math.min(a.bottom + 10, window.innerHeight - t.height - 12));
      setPosition({ left, top });
    }, [open]);
    React.useEffect(() => {
      if (!open) return;
      const dismiss = e => { if(e?.type === "scroll" && tip.current?.contains(e.target)) return; setOpen(false); };
      const escape = e => { if (e.key === "Escape") { e.stopPropagation(); dismiss(); } };
      window.addEventListener("resize", dismiss);
      window.addEventListener("scroll", dismiss, true);
      document.addEventListener("keydown", escape, true);
      return () => {
        window.removeEventListener("resize", dismiss);
        window.removeEventListener("scroll", dismiss, true);
        document.removeEventListener("keydown", escape, true);
      };
    }, [open]);
    async function change() {
      const id = sessionId, next = !enabled;
      setBusy(true); setError("");
      try {
        await api("evolith?session_id=" + encodeURIComponent(id), "PUT", { enabled: next });
        if (currentSession.current === id) { setEnabled(next); setQuota(null); }
      } catch (e) { if (currentSession.current === id) setError(e.message); }
      finally { if (currentSession.current === id) setBusy(false); }
    }
    const tooltip = open ? createPortal(
      h("div", { ref: tip, id: tooltipId, role: "tooltip", className: "dsh-evolith-tooltip",
        style: { left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" },
        onMouseEnter: pointerEnter, onMouseLeave: pointerLeave },
        h("div", { className: "dsh-evolith-tooltip-title" }, "Evolith 模式"),
        h("p", null, "可在同一个 session 中持续对话，通过记忆管理减少重复上下文、节省 token，并可能改善效果。"),
        h("div", { className: "dsh-evolith-privacy" },
          h("strong", null, "默认开启 · 会话内容将发送至记忆服务端"),
          h("p", null, "整个 session 的用户消息、模型回复和工具结果将发送至你配置的服务端处理与保存。")),
        h("p", { className: "dsh-evolith-tooltip-foot" }, "可随时关闭或重新开启。关闭后停止记忆管理，不再上传会话数据；已插入的历史记忆不会自动删除。")), document.body) : null;
    return h("span", { className: "dsh-evolith-control" },
      h("button", { type: "button", role: "switch", className: "dsh-evolith-switch", "aria-label": "启用Evolith模式",
        "aria-checked": enabled, "aria-busy": busy || undefined, disabled: busy || !sessionId, title: enabled ? "关闭 Evolith" : "开启 Evolith", onClick: change },
        h("span", { className: "dsh-evolith-track", "aria-hidden": true }, h("span", { className: "dsh-evolith-thumb" })),
        h("span", null, "Evolith")),
      h("button", { ref: help, type: "button", className: "dsh-evolith-help", "aria-label": "Evolith 模式说明",
        "aria-expanded": open, "aria-describedby": open ? tooltipId : undefined,
        onMouseEnter: pointerEnter, onMouseLeave: pointerLeave, onFocus: focusEnter, onBlur: focusLeave, onClick: () => { help.current?.focus(); showHelp(); } },
        h("svg", { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          h("circle", { cx: 10, cy: 10, r: 7.6 }),
          h("path", { d: "M7.8 7.6a2.3 2.3 0 0 1 4.5.7c0 1.6-2.3 1.9-2.3 3.3" }),
          h("circle", { cx: 10, cy: 14.2, r: .65, fill: "currentColor", stroke: "none" }))),
      enabled && quotaMessages[quota?.quota_reason] ? h("a", {href: quota.workbench_url,
        target: "_blank", rel: "noopener noreferrer", role: "status",
        style: {fontSize: 12, color: "inherit"}, title: "打开记忆额度"},
        quotaMessages[quota.quota_reason]) : null,
      error ? h("span", { role: "alert", title: error, style: { color: "#b42318", fontSize: 12 } }, "设置失败") : null,
      tooltip);
  }
  function Settings() {
    const [url, setUrl] = React.useState(""), [token, setToken] = React.useState(""), [data, setData] = React.useState({ errors: [] }), [message, setMessage] = React.useState("");
    const [quota, setQuota] = React.useState(null);
    async function loadQuota() {
      try { setQuota(await api("quota")); }
      catch { setQuota({ unavailable: true }); }
    }
    async function load() {
      const r = await fetch("/dsh-memory-bridge/status", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw Error("无法读取本地设置");
      const d = await r.json();
      setData(d);
      setUrl(d.server.url);
      if (d.server.token_configured) await loadQuota();
      else setQuota(null);
    }
    React.useEffect(() => {
      load().catch((e) => setMessage(e.message));
      const t = setInterval(() => {
        fetch("/dsh-memory-bridge/status", { credentials: "same-origin" }).then((r) => r.json()).then(setData).catch(() => {
        });
      }, 4e3);
      return () => clearInterval(t);
    }, []);
    const button = (text, fn) => h("button", { type: "button", onClick: () => {
      try {
        return Promise.resolve(fn()).catch((e) => setMessage(e.message));
      } catch (e) {
        setMessage((text === "记忆管理" ? "内置浏览器未能打开：" : "") + e.message);
      }
    }, style: { padding: "8px 14px", border: "1px solid #d8dce2", borderRadius: 8, background: "white", cursor: "pointer" } }, text);
    return h(
      "section",
      { style: { maxWidth: 1e3, display: "grid", gap: 16 } },
      h("h2", { style: { margin: 0, fontSize: 24 } }, "记忆"),
      h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "Evolith 默认开启，可在会话输入框旁随时关闭或重新开启。"),
      h("div", { style: { display: "flex", gap: 10 } }, button("刷新", load), button("记忆管理", () => {
        const target = new URL("/workbench", url).href;
        const side = hostContext?.get?.("sidebarRight"), tabs = hostContext?.get?.("sidebarRightTabs");
        if (side?.openTab && tabs?.get("browser")) side.openTab("browser", { params: { url: target }, revealIfOpened: false });
        else window.open(target, "_blank", "noopener,noreferrer");
      }), h("a", { href: data.server?.url ? new URL("/workbench", data.server.url).href : void 0, target: "_blank", rel: "noopener noreferrer", style: { padding: "8px 14px", border: "1px solid #d8dce2", borderRadius: 8, textDecoration: "none", color: "inherit", fontSize: 13 } }, "系统浏览器打开")),
      quota?.enabled && data.server?.url ? h("div", {style: {display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline"}},
        h("strong", null, "记忆额度 · 剩余 " + Number(quota.remaining_tokens).toLocaleString("zh-CN") + " Token"),
        h("a", {href: new URL("/workbench#groups", data.server.url).href, target: "_blank", rel: "noopener noreferrer"},
          quota.redeem_available ? "兑换加油包" : "查看用量"),
        quotaMessages[quota.reason] ? h("span", null, quotaMessages[quota.reason]) : null
      ) : quota?.unavailable ? h("p", {role: "status"}, "暂时无法读取记忆额度") : null,
      h("section", { style: { padding: 24, border: "1px solid #e0e2e5", borderRadius: 12, background: "#f7f8fa", display: "grid", gap: 16 } }, h("h3", { style: { margin: 0, fontSize: 18 } }, "线上服务连接"), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "先保存连接配置，再检查服务是否可访问。"), h("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16 } }, h("label", { style: { display: "grid", gap: 8, fontSize: 14 } }, "服务器地址", h("input", { type: "url", value: url, onChange: (e) => setUrl(e.target.value), style: { width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #d8dce2", background: "white" } })), h("label", { style: { display: "grid", gap: 8, fontSize: 14 } }, h("span", null, "访问密钥", data.server?.token_configured ? h("span", { style: { marginLeft: 8, fontSize: 12, color: "#15805d" } }, "已保存") : null), h("input", { type: "password", autoComplete: "new-password", value: token, onChange: (e) => setToken(e.target.value), placeholder: data.server?.token_configured ? "****" : "请输入访问密钥", style: { width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #d8dce2", background: "white" } }))), h("div", { style: { display: "flex", gap: 10 } }, button("保存连接配置", async () => {
        await api("registry", "PUT", { server_url: url, ...token.trim() ? { api_token: token.trim() } : {} });
        setToken("");
        setMessage("已保存");
        await load();
      }), button("检查连接", async () => {
        const d = await api("check", "POST", {});
        setMessage("连接正常 · " + d.group_id);
        await loadQuota();
      })), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "注册后会自动创建默认记忆组和访问密钥。填写账号密钥即可共享该账号的记忆，无需配置 Group ID。"), h("p", { role: "status" }, message)),
      h("details", { style: { padding: 16, border: "1px solid #e0e2e5", borderRadius: 10 } }, h("summary", null, "本地错误日志（" + (data.errors?.length || 0) + "）"), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "仅在本地展示客户端报错，不上传到记忆服务器。"), h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" } }, data.errors?.length ? data.errors.map((x) => x.at + " " + x.message).join("\n") : "暂无错误"))
    );
  }
  function apply(ctx) {
    hostContext = ctx;
    ctx.inject?.(['sidebarRightTabs','sidebarRight'], scoped=>{
      scoped.effect(()=>scoped.sidebarRightTabs.register({id:verificationTab,kind:verificationKind,title:()=> '记忆使用记录',guide:[{id:'verified-memory',order:55,title:()=> '记忆使用记录',description:()=> '查看当前对话用到的记忆及具体帮助'}]}));
      scoped.slots.inject('sidebar.right.pane.tab',()=>scoped.slots.register({name:'sidebar.right.pane.tab',key:verificationTab},VerifiedMemories));
    });
    ctx.effect(() => {
      const style = document.createElement("style");
      style.dataset.evolithControls = "1";
      style.textContent = controlStyles;
      document.head.appendChild(style);
      return () => style.remove();
    });
    ctx.effect(() => {
      const report = (e) => {
        api("client-error", "POST", { message: String(e.message || e.reason?.message || e.reason || "客户端错误") }).catch(() => {
        });
      };
      window.addEventListener?.("error", report);
      window.addEventListener?.("unhandledrejection", report);
      return () => {
        window.removeEventListener?.("error", report);
        window.removeEventListener?.("unhandledrejection", report);
      };
    });
    ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({name:"conversation.chat.assistant-actions",id:"evolith-memory-buff",order:20},TurnMemoryBuff));
    ctx.slots.inject("conversation.input.left", () => ctx.slots.register({ name: "conversation.input.left", id: "evolith-mode", order: 40 }, Toggle));
    ctx.effect(() => ctx.locale.register("settings.memoryBridge", { zh: { nav: "记忆" }, en: { nav: "Memory" } }));
    ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "memory-bridge", order: 45, label: () => ctx.locale.bind("settings.memoryBridge")("nav") }, Settings));
  }
  return { apply, inject: ["slots", "locale"] };
} });
