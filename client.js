window.__ModuleLoader__.load({ id: "dsh-memory-bridge-profile", factory: (require) => {
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
@media(prefers-reduced-motion:reduce){.dsh-evolith-track,.dsh-evolith-thumb{transition:none}}
`;
  const verificationKind='evolith-verified-memory', verificationTab='dsh-memory-bridge-profile.verified-memory';
  function openVerifications(sessionId){
    const side=hostContext?.get?.('sidebarRight'),tabs=hostContext?.get?.('sidebarRightTabs');
    if(!sessionId||!tabs?.get(verificationKind)||!side?.openTabIn)return;
    side.openTabIn(sessionId,verificationKind,{revealIfOpened:true});
  }
  const openedVerificationTurns=new Set();
  function watchVerificationResults(source,onVerified){
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
      if(!notify||!turnOpen||event.data?.turn!==currentTurn||message?.isError)return;
      if(calls.get(message?.toolCallId||message?.source?.callId)!=='evolith_record_verified_memory')return;
      try{
        const result=JSON.parse((message.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''));
        if(result.recorded===true&&result.status==='actor_verified_with_evidence'&&typeof result.record_id==='string')onVerified(currentTurn);
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
    const [data,setData]=React.useState({records:[]}),[error,setError]=React.useState(''),[loading,setLoading]=React.useState(true);
    const current=React.useRef(sessionId);current.current=sessionId;
    async function refresh(){const id=sessionId;try{const d=await api('verified-memory?session_id='+encodeURIComponent(id));if(current.current===id){setData(d);setError('');setLoading(false)}}catch(e){if(current.current===id){setError(e.message);setLoading(false)}}}
    React.useEffect(()=>{
      let live=true;setData({records:[]});setError('');setLoading(true);
      if(!sessionId){setLoading(false);return}
      const load=async()=>{try{const d=await api('verified-memory?session_id='+encodeURIComponent(sessionId));if(live){setData(d);setError('');setLoading(false)}}catch(e){if(live){setError(e.message);setLoading(false)}}};
      load();const timer=setInterval(load,2000);return()=>{live=false;clearInterval(timer)};
    },[sessionId]);
    const records=data.records||[];
    return h('section',{className:'dsh-evolith-verified-panel','aria-label':'当前对话已验证记忆'},
      h('div',{className:'dsh-evolith-verified-heading'},h('div',null,h('h2',null,'本次用到的记忆'),h('span',{className:'dsh-evolith-verified-muted'},'当前对话 · '+records.length+'条记录')),h('button',{type:'button',className:'dsh-evolith-verified-refresh',onClick:refresh},'刷新')),
      h('p',{className:'dsh-evolith-verified-explanation'},'这里只展示助手实际用过、并核实过的记忆。'),
      data.enabled===false?h('p',{className:'dsh-evolith-verified-muted'},'本会话已关闭 Evolith，保留此前的验证记录。'):null,
      error?h('p',{role:'alert',className:'dsh-evolith-verified-error'},'读取失败：'+error):null,
      loading?h('p',{role:'status',className:'dsh-evolith-verified-muted'},'正在读取…'):null,
      !loading&&!error&&!records.length?h('div',{className:'dsh-evolith-verified-empty'},h('strong',null,'暂时没有已验证记忆'),h('p',null,'助手确认某条记忆有用且正确后，会自动记录在这里。')):null,
      ...records.slice().reverse().map(record=>{const copy=memoryCardCopy(record);return h('article',{key:record.id,className:'dsh-evolith-verified-card'},
        h('div',{className:'dsh-evolith-verified-status'},h('span',{'aria-hidden':true},'✓'),h('span',null,'已使用 · 已核实'),h('span',{className:'dsh-evolith-verified-round'},'第'+record.verified_turn+'轮')),
        h('div',{className:'dsh-evolith-verified-eyebrow'},'记忆内容'),
        h('h3',{className:'dsh-evolith-verified-title'},copy.title),
        h('div',{className:'dsh-evolith-verified-summary'},h('strong',null,'本次用途'),h('p',null,copy.usage)),
        h('details',{className:'dsh-evolith-verified-details'},h('summary',null,'查看原文与证据'),
          h('dl',null,h('dt',null,'记忆原文'),h('dd',null,record.memory_text),h('dt',null,'使用详情'),h('dd',null,record.application),h('dt',null,'核实说明'),h('dd',null,record.verification_reason),h('dt',null,'证据原文'),h('dd',null,h('pre',null,record.evidence?.quote),h('span',{className:'dsh-evolith-verified-muted'},'第'+record.evidence?.source_turn+'轮 · '+(record.evidence?.tool_name||'用户消息'))),h('dt',null,'记忆编号与来源'),h('dd',null,h('code',null,record.memory_id),h('p',null,record.provenance||'来源未标注'),h('code',null,record.memory_version?.slice(0,12))))));}),
      records.length?h('p',{className:'dsh-evolith-verified-muted'},'核实结论由助手根据所列依据作出。'):null);
  }
  function Toggle({ sessionId } = {}) {
    const [enabled, setEnabled] = React.useState(false);
    const [busy, setBusy] = React.useState(true);
    const [error, setError] = React.useState("");
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
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
      setBusy(true); setEnabled(false); setError(""); setOpen(false);
      if (!sessionId) { setBusy(false); return () => { live = false; }; }
      api("evolith?session_id=" + encodeURIComponent(sessionId)).then(d => {
        if (live) setEnabled(d.enabled === true);
      }).catch(e => { if (live) setError(e.message); })
        .finally(() => { if (live) setBusy(false); });
      return () => { live = false; cancelHide(); };
    }, [sessionId]);
    React.useEffect(()=>{
      if(!enabled||!sessionId)return;
      const source=hostContext?.get?.('sessions')?.binding?.(sessionId)?.eventSource;
      if(!source?.subscribe||!source?.getSnapshot)return;
      return watchVerificationResults(source,turn=>{
        if(currentSession.current!==sessionId)return;
        const key=sessionId+':'+turn;
        if(openedVerificationTurns.has(key))return;
        openedVerificationTurns.add(key);openVerifications(sessionId);
      });
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
        if (currentSession.current === id) setEnabled(next);
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
          h("strong", null, "开启即表示允许上传会话内容"),
          h("p", null, "整个 session 的用户消息、模型回复和工具结果将发送至你配置的服务端处理与保存。")),
        h("p", { className: "dsh-evolith-tooltip-foot" }, "关闭后不接入 Evolith，也不再上传会话数据。")), document.body) : null;
    return h("span", { className: "dsh-evolith-control" },
      h("button", { type: "button", role: "switch", className: "dsh-evolith-switch", "aria-label": "启用Evolith模式",
        "aria-checked": enabled, "aria-busy": busy || undefined, disabled: busy || !sessionId, onClick: change },
        h("span", { className: "dsh-evolith-track", "aria-hidden": true }, h("span", { className: "dsh-evolith-thumb" })),
        h("span", null, "Evolith")),
      h("button", { ref: help, type: "button", className: "dsh-evolith-help", "aria-label": "Evolith 模式说明",
        "aria-expanded": open, "aria-describedby": open ? tooltipId : undefined,
        onMouseEnter: pointerEnter, onMouseLeave: pointerLeave, onFocus: focusEnter, onBlur: focusLeave, onClick: () => { help.current?.focus(); showHelp(); } },
        h("svg", { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
          h("circle", { cx: 10, cy: 10, r: 7.6 }),
          h("path", { d: "M7.8 7.6a2.3 2.3 0 0 1 4.5.7c0 1.6-2.3 1.9-2.3 3.3" }),
          h("circle", { cx: 10, cy: 14.2, r: .65, fill: "currentColor", stroke: "none" }))),
      enabled ? h('button',{type:'button',className:'dsh-evolith-help','aria-label':'查看已验证记忆',title:'查看本对话已使用并验证的记忆',onClick:()=>openVerifications(sessionId)},
        h('svg',{width:17,height:17,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},h('path',{d:'M10 2.4 16 5v4.4c0 3.6-2.6 5.9-6 8.2-3.4-2.3-6-4.6-6-8.2V5Z'}),h('path',{d:'m6.7 9.5 2.1 2.1 4.4-4.4'}))) : null,
      error ? h("span", { role: "alert", title: error, style: { color: "#b42318", fontSize: 12 } }, "设置失败") : null,
      tooltip);
  }
  function Settings() {
    const [url, setUrl] = React.useState(""), [token, setToken] = React.useState(""), [data, setData] = React.useState({ errors: [] }), [message, setMessage] = React.useState("");
    async function load() {
      const r = await fetch("/dsh-memory-bridge/status", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw Error("无法读取本地设置");
      const d = await r.json();
      setData(d);
      setUrl(d.server.url);
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
      h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "仅对主动开启 Evolith 的会话启用记忆管理。"),
      h("div", { style: { display: "flex", gap: 10 } }, button("刷新", load), button("记忆管理", () => {
        const target = new URL("/workbench", url).href;
        const side = hostContext?.get?.("sidebarRight"), tabs = hostContext?.get?.("sidebarRightTabs");
        if (side?.openTab && tabs?.get("browser")) side.openTab("browser", { params: { url: target }, revealIfOpened: false });
        else window.open(target, "_blank", "noopener,noreferrer");
      }), h("a", { href: data.server?.url ? new URL("/workbench", data.server.url).href : void 0, target: "_blank", rel: "noopener noreferrer", style: { padding: "8px 14px", border: "1px solid #d8dce2", borderRadius: 8, textDecoration: "none", color: "inherit", fontSize: 13 } }, "系统浏览器打开")),
      h("section", { style: { padding: 24, border: "1px solid #e0e2e5", borderRadius: 12, background: "#f7f8fa", display: "grid", gap: 16 } }, h("h3", { style: { margin: 0, fontSize: 18 } }, "线上服务连接"), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "先保存连接配置，再检查服务是否可访问。"), h("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 16 } }, h("label", { style: { display: "grid", gap: 8, fontSize: 14 } }, "服务器地址", h("input", { type: "url", value: url, onChange: (e) => setUrl(e.target.value), style: { width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #d8dce2", background: "white" } })), h("label", { style: { display: "grid", gap: 8, fontSize: 14 } }, "访问密钥", h("input", { type: "password", autoComplete: "new-password", value: token, onChange: (e) => setToken(e.target.value), placeholder: data.server?.token_configured ? "已保存，留空则保留" : "填写账号默认访问密钥", style: { width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: "1px solid #d8dce2", background: "white" } }))), h("div", { style: { display: "flex", gap: 10 } }, button("保存连接配置", async () => {
        await api("registry", "PUT", { server_url: url, ...token.trim() ? { api_token: token.trim() } : {} });
        setToken("");
        setMessage("已保存");
        await load();
      }), button("检查连接", async () => {
        const d = await api("check", "POST", {});
        setMessage("连接正常 · " + d.group_id);
      })), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "注册后会自动创建默认记忆组和访问密钥。填写账号密钥即可共享该账号的记忆，无需配置 Group ID。"), h("p", { role: "status" }, message)),
      h("details", { style: { padding: 16, border: "1px solid #e0e2e5", borderRadius: 10 } }, h("summary", null, "本地错误日志（" + (data.errors?.length || 0) + "）"), h("p", { style: { margin: 0, fontSize: 13, lineHeight: 1.6, color: "#737b89" } }, "仅在本地展示客户端报错，不上传到记忆服务器。"), h("pre", { style: { whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" } }, data.errors?.length ? data.errors.map((x) => x.at + " " + x.message).join("\n") : "暂无错误"))
    );
  }
  function apply(ctx) {
    hostContext = ctx;
    ctx.inject?.(['sidebarRightTabs','sidebarRight'], scoped=>{
      scoped.effect(()=>scoped.sidebarRightTabs.register({id:verificationTab,kind:verificationKind,title:()=> '已验证记忆',guide:[{id:'verified-memory',order:55,title:()=> '已验证记忆',description:()=> '查看当前对话实际使用的记忆与验证依据'}]}));
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
    ctx.slots.inject("conversation.input.left", () => ctx.slots.register({ name: "conversation.input.left", id: "evolith-mode", order: 40 }, Toggle));
    ctx.effect(() => ctx.locale.register("settings.memoryBridge", { zh: { nav: "记忆" }, en: { nav: "Memory" } }));
    ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "memory-bridge", order: 45, label: () => ctx.locale.bind("settings.memoryBridge")("nav") }, Settings));
  }
  return { apply, inject: ["slots", "locale"] };
} });
