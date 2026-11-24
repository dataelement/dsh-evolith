import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function viewFixture(records=[]){
 let definition,cursor=0;const tabs=[],entries=[],calls=[];
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const i=cursor++;return[i===0?{records,enabled:true}:i===2?false:initial,()=>{}]},useRef:value=>({current:value}),useEffect(){},useLayoutEffect(){},useId:()=> 'id'};
 runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},fetch:async(url)=>{calls.push(url);return {ok:true,json:async()=>({records,enabled:true})}}});
 const ctx={get(){},effect:fn=>fn(),locale:{register(){},bind:()=>()=>''},slots:{inject:(_name,fn)=>fn(),register:(opts,component)=>entries.push({opts,component})},sidebarRightTabs:{register:d=>{tabs.push(d);return()=>{}}}};ctx.inject=(_deps,fn)=>fn(ctx);
 definition.factory(n=>n==='react'?react:{createPortal(){}}).apply(ctx);
 const panel=entries.find(e=>e.opts.name==='sidebar.right.pane.tab');
 const nodes=t=>t&&typeof t==='object'?[t,...t.children.flat(Infinity).flatMap(nodes)]:[];
 const text=t=>t&&typeof t==='object'?t.children.flat(Infinity).map(text).join(''):String(t??'');
 return {tabs,panel,calls,nodes,text,render:()=>{cursor=0;return panel.component({sessionId:'session-current'})}};
}
test('verified-memory list uses the native right-sidebar tab instead of a new workbench',async()=>{
 const f=await viewFixture();assert.equal(f.tabs[0].kind,'evolith-verified-memory');assert.equal(f.panel.opts.key,f.tabs[0].id);const tree=f.render();assert.match(f.text(tree),/暂时没有记忆使用记录/);assert.equal(f.calls.length,0);
});
test('verified-memory card shows original claim, application, evidence and actor attribution',async()=>{
 const f=await viewFixture([{id:'record',memory_id:'policy-1',title:'转账手续费已核对',usage_summary:'这条记忆帮助核算了本次转账金额。',verification_summary:'对照最新报价确认费用为4.50美元。',memory_text:'Bank transfer fee is USD 4.50.',memory_version:'abc123',application:'Applied the transfer fee.',verification_reason:'The live quote confirms the same amount.',verified_turn:5,evidence:{source_kind:'tool_result',source_turn:5,tool_name:'get_quote',quote:'processing_fee USD 4.50'}}]);
 const text=f.text(f.render());for(const expected of ['转账手续费已核对','这条记忆帮助核算','policy-1','Bank transfer fee','Applied the transfer fee','live quote','processing_fee USD 4.50','已使用 · 已核实','第5轮'])assert.ok(text.includes(expected),expected);assert.ok(!text.includes('独立评分通过'));assert.ok(!text.includes('对照最新报价'));assert.ok(!text.includes('核实依据'));assert.ok(text.includes('processing_fee USD 4.50'));
});

test('legacy technical records get a plain title and hide raw details by default',async()=>{
 const f=await viewFixture([{id:'legacy',memory_id:'observation_ep0_evaluator_feedback_002',memory_text:'observation: No evaluator feedback supplied.',application:'technical settled / outbox details',verification_reason:'technical checks',verified_turn:7,evidence:{source_kind:'tool_result',source_turn:7,tool_name:'bash',quote:'{"events":[]}'}}]);
 const tree=f.render(),all=f.nodes(tree),title=all.find(n=>n.type==='h3');assert.equal(f.text(title),'当时没有提供评测反馈');
 const visibleText=n=>n&&typeof n==='object'?(n.type==='details'?n.children.filter(c=>c&&c.type==='summary'):n.children).flat(Infinity).map(visibleText).join(''):String(n??'');
 const visible=visibleText(tree);assert.ok(!visible.includes('observation_ep0'));assert.ok(!visible.includes('{"events"'));assert.ok(visible.includes('本次用途'));assert.ok(!visible.includes('核实依据'));assert.ok(all.filter(n=>n.type==='details').every(n=>!n.props.open));
});

async function popupFixture(initial=[]){
 let definition,Toggle,seq=0;const opened=[],effects=[],cleanups=[];
 const entry=event=>({type:'event',event});
 let snapshot={entries:initial.map(entry),change:{kind:'replace',entries:initial.map(entry)}};const listeners=new Set();
 const source={getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const i=seq++;return[i===0?true:i===1?false:initial,()=>{}]},useRef:initial=>({current:initial}),useId:()=> 'help',useEffect:fn=>effects.push(fn),useLayoutEffect(){}};
 runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>definition=d}},document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},fetch:async()=>({ok:true,json:async()=>({enabled:true})})});
 const services={sessions:{binding:()=>({eventSource:source})},sidebarRightTabs:{get:()=>({})},sidebarRight:{openTabIn:(...args)=>opened.push(args)}};
 definition.factory(n=>n==='react'?react:{createPortal(){}}).apply({get:n=>services[n],effect:fn=>fn(),slots:{inject:(_n,fn)=>fn(),register:(opts,component)=>{if(opts.id==='evolith-mode')Toggle=component}},locale:{register(){},bind:()=>()=>''}});
 const tree=Toggle({sessionId:'current-session'});for(const fn of effects){const dispose=fn();if(typeof dispose==='function')cleanups.push(dispose)}
 const emit=(event,kind='append')=>{const e=entry(event);snapshot={entries:[...snapshot.entries,e],change:kind==='settle-assistant'?{kind,entry:e}:{kind,entries:[e]}};for(const fn of listeners)fn()};
 const nodes=t=>t&&typeof t==='object'?[t,...t.children.flat(Infinity).flatMap(nodes)]:[];
 return {opened,emit,tree,nodes,cleanup:()=>cleanups.forEach(fn=>fn())};
}
const start=(turn,seq)=>({type:'turn/start',seq,data:{turn}});
const call=(turn,seq,id,name='evolith_record_verified_memory')=>({type:'assistant/message',seq,data:{turn,message:{content:[{type:'tool-call',id,name}]}}});
const result=(turn,seq,id,overrides={})=>({type:'tool/result',seq,data:{turn,message:{toolCallId:id,isError:false,content:[{type:'text',text:JSON.stringify({recorded:true,status:'actor_reported_helpfulness',record_id:'record',memory_id:'m'})}],...overrides}}});
test('loading an enabled session and its old tool results does not auto-open the panel',async()=>{
 const f=await popupFixture([start(1,1),call(1,2,'old'),result(1,3,'old'),{type:'turn/end',seq:4,data:{turn:1}}]);await new Promise(r=>setImmediate(r));assert.equal(f.opened.length,0);f.cleanup();
});
test('a newly settled verification call opens only after its successful result, once per turn',async()=>{
 const f=await popupFixture();f.emit(start(2,5));f.emit(call(2,6,'live'),'settle-assistant');assert.equal(f.opened.length,0);f.emit(result(2,7,'live'));assert.equal(f.opened.length,1);assert.equal(f.opened[0][0],'current-session');
 f.emit(result(2,7,'live'));f.emit(call(2,8,'again'));f.emit(result(2,9,'again'));assert.equal(f.opened.length,1);f.emit(start(3,10));f.emit(call(3,11,'next'));f.emit(result(3,12,'next'));assert.equal(f.opened.length,2);f.cleanup();
});
test('failures, unrelated tools, historical replay and unmounted sessions never auto-open',async()=>{
 const f=await popupFixture();f.emit(start(1,1));f.emit(call(1,2,'failed'));f.emit(result(1,3,'failed',{isError:true}));f.emit(call(1,4,'other','bash'));f.emit(result(1,5,'other'));f.emit(call(1,6,'historical'),'prepend');f.emit(result(1,7,'historical'),'prepend');assert.equal(f.opened.length,0);
 f.cleanup();f.emit(call(1,8,'after-unmount'));f.emit(result(1,9,'after-unmount'));assert.equal(f.opened.length,0);
});
test('manual viewing still opens the panel without any new tool call',async()=>{
 const f=await popupFixture();const button=f.nodes(f.tree).find(n=>n.props['aria-label']==='查看记忆使用记录');button.props.onClick();assert.equal(f.opened.length,1);f.cleanup();
});


test('legacy unfinished-task memory shows its actual claim rather than a verification placeholder',async()=>{
 const f=await viewFixture([{id:'legacy',memory_text:'agent_final_output: Business dialogue batch boundary; task remains unfinished.',application:'Continue the ongoing work.',verified_turn:7,evidence:{source_kind:'tool_result'}}]);
 const title=f.nodes(f.render()).find(n=>n.type==='h3');assert.equal(f.text(title),'当时任务尚未完成，仍需继续处理');
});
test('unknown legacy memories use the saved claim and do not invent use or proof summaries',async()=>{
 const f=await viewFixture([{id:'legacy',memory_text:'Transfer limit is USD 200.',verified_turn:7,evidence:{source_kind:'tool_result'}}]);
 const tree=f.render();assert.equal(f.text(f.nodes(tree).find(n=>n.type==='h3')),'Transfer limit is USD 200.');assert.ok(!f.text(tree).includes('本次处理引用了这条记忆中的信息'));assert.ok(!f.text(tree).includes('已对照本对话中的实际结果核实'));
});

test('three-field usage records show benefit and resolved memory without claiming verification',async()=>{
 const f=await viewFixture([{id:'usage',memory_id:'m1',title:'先确认收款方',usage_summary:'根据记忆检查收款方，规避向旧收款方付款的风险。',memory_text:'Confirm the current payee before payment.',used_turn:4,usage_source:'actor_reported_use'}]);
 const text=f.text(f.render());assert.match(text,/规避向旧收款方付款/);assert.match(text,/Confirm the current payee/);assert.match(text,/第4轮/);assert.ok(!text.includes('已使用 · 已核实'));assert.ok(!text.includes('证据原文'));
});

for(const [benefit_type,expected] of [
 ['avoid_error',['避免问题 BUFF']],['save_tool_calls',['节省调用 BUFF']],['both',['避免问题 BUFF','节省调用 BUFF']],
 [undefined,[]],['unknown',[]]
])test('benefit BUFFs use only the explicit enum: '+benefit_type,async()=>{
 const f=await viewFixture([{id:'buff',title:'测试记忆',memory_text:'Stored memory',benefit_type,usage_summary:'避免了误答成 pytest 的错误，并省去了重复查询。',used_turn:1,usage_source:'actor_reported_use'}]);
 const badges=f.nodes(f.render()).filter(n=>n.props.role==='img').map(n=>n.props['aria-label']);assert.deepEqual(badges,expected);
 for(const badge of f.nodes(f.render()).filter(n=>n.props.role==='img')){assert.match(badge.props.title,/助手选择/);assert.ok(f.nodes(badge).some(n=>n.type==='svg'));}
});

test('potentially useful memories are not presented as verified or already used',async()=>{
 const f=await viewFixture([{id:'potential',memory_id:'m',title:'手续费可能另付',usage_summary:'可能帮助预留手续费，尚未验证。',memory_text:'Fee may be paid separately.',used_turn:1,usage_source:'actor_reported_helpfulness',benefit_type:'avoid_error'}]);
 const text=f.text(f.render());assert.match(text,/可能有帮助/);assert.match(text,/尚未验证/);assert.ok(!text.includes('已使用 · 已核实'));assert.ok(!text.includes('证据原文'));
});
