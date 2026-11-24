import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function fixture(records={}){
 let definition,Toggle,cursor=0,id='a';const cells=[],effects=[],opened=[];const sources=new Map();
 const source=key=>{if(!sources.has(key)){let entries=[],change={kind:'replace',entries:[]};const listeners=new Set();sources.set(key,{getSnapshot:()=>({entries,change}),subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},emit:event=>{const entry={event};entries=[...entries,entry];change={kind:'append',entries:[entry]};for(const f of listeners)f()}})}return sources.get(key)};
 const react={createElement:(type,props,...children)=>({type,props:props||{},children}),useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],v=>cells[i]=typeof v==='function'?v(cells[i]):v]},useRef(initial){const i=cursor++;return cells[i]??=( {current:initial})},useId:()=> 'trigger-help',useEffect(fn,deps){const i=cursor++,old=cells[i];if(!old||deps?.some((x,j)=>x!==old.deps[j])){effects.push(()=>{old?.cleanup?.();cells[i]={deps,cleanup:fn()}})}},useLayoutEffect(fn,deps){this.useEffect(fn,deps)}};
 runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{URL,window:{__ModuleLoader__:{load:d=>definition=d}},document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},fetch:async path=>({ok:true,json:async()=>path.includes('verified-memory')?{records:await(records[new URL(path,'http://fixture').searchParams.get('session_id')]||[])}:{enabled:true}})});
 const services={sessions:{binding:key=>({eventSource:source(key)})},sidebarRightTabs:{get:()=>({})},sidebarRight:{openTabIn:(...args)=>opened.push(args)}};
 definition.factory(n=>n==='react'?react:{createPortal(){}}).apply({get:n=>services[n],effect:f=>f(),locale:{register(){},bind:()=>()=>''},slots:{inject:(_,f)=>f(),register:(o,c)=>{if(o.id==='evolith-mode')Toggle=c}}});
 const render=()=>{cursor=0;const tree=Toggle({sessionId:id});while(effects.length)effects.shift()();return tree};
 const nodes=t=>t&&typeof t==='object'?[t,...t.children.flat(Infinity).flatMap(nodes)]:[];
 const button=()=>nodes(render()).find(n=>n.props['aria-label']==='查看记忆使用记录');
 const settle=async()=>{await new Promise(r=>setImmediate(r));render();await new Promise(r=>setImmediate(r));};
 render();await settle();return{render,nodes,button,opened,emit:(event,key=id)=>source(key).emit(event),switch:async key=>{id=key;render();await settle()},settle};
}
const start=(turn=1)=>({type:'turn/start',seq:turn*10,data:{turn}});
const call=(seq=11,name='evolith_record_verified_memory')=>({type:'assistant/message',seq,data:{turn:1,message:{content:[{type:'tool-call',id:'c'+seq,name}]}}});
const result=(seq=12,callSeq=11,benefit_type='avoid_error',isError=false)=>({type:'tool/result',seq,data:{turn:1,message:{toolCallId:'c'+callSeq,isError,content:[{type:'text',text:JSON.stringify({recorded:true,status:'actor_reported_helpfulness',record_id:'r'+seq,benefit_type})}]}}});
const icons=f=>f.nodes(f.button()).filter(n=>n.props.role==='img');
for(const [records,expected] of [
 [[],null],[[{benefit_type:'avoid_error'}],'已触发避免问题'],[[{benefit_type:'save_tool_calls'}],'已触发节省调用'],[[{benefit_type:'both'}],'已触发避免问题和节省调用'],[[{benefit_type:'avoid_error'},{benefit_type:'save_tool_calls'}],'已触发避免问题和节省调用']
])test('toolbar restores a single benefit symbol: '+expected,async()=>{
 const f=await fixture({a:records});assert.equal(icons(f).length,expected?1:0);if(expected)assert.equal(icons(f)[0].props['aria-label'],expected);assert.equal(f.opened.length,0);
});
test('live benefits accumulate within the session but both still use one icon',async()=>{
 const f=await fixture();f.emit(start());f.emit(call());f.emit(result());assert.equal(icons(f)[0].props['aria-label'],'已触发避免问题');
 f.emit(call(13));f.emit(result(14,13,'save_tool_calls'));assert.equal(icons(f).length,1);assert.equal(icons(f)[0].props['aria-label'],'已触发避免问题和节省调用');assert.equal(f.opened.length,1);
 f.emit(start(2));assert.equal(icons(f).length,1);
 await f.switch('b');assert.equal(icons(f).length,0);
 f.emit(call(15),'a');f.emit(result(16,15,'both'),'a');assert.equal(icons(f).length,0);
});
test('failed calls, other tools and missing types never highlight the toolbar',async()=>{
 const f=await fixture();f.emit(start());f.emit(call());f.emit(result(12,11,'both',true));assert.equal(icons(f).length,0);
 f.emit(call(13,'read_file'));f.emit(result(14,13,'both'));assert.equal(icons(f).length,0);
 f.emit(call(15));f.emit(result(16,15,'unknown'));assert.equal(icons(f).length,0);
});
test('a delayed response from the previous session cannot highlight the new session',async()=>{
 let release;const pending=new Promise(r=>release=r),f=await fixture({a:pending});await f.switch('b');release([{benefit_type:'both'}]);await f.settle();assert.equal(icons(f).length,0);
});
