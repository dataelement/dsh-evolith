import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {JSDOM} from 'jsdom';

const {act}=React;
const sourceCode=await readFile(new URL('../client.js',import.meta.url),'utf8');
const start=(turn,seq=turn*100)=>({type:'turn/start',seq,data:{turn}});
const assistant=(turn,id,seq=turn*100+20,content=[{type:'text',text:'Answer'}])=>({type:'assistant/message',seq,data:{turn,message:{id,content}}});
const end=(turn,seq=turn*100+30)=>({type:'turn/end',seq,data:{turn}});
const record=(turn,benefit_type,title='Memory '+turn,extra={})=>({id:title,memory_id:'m-'+title,memory_version:'hash',title,memory_text:'Full text: '+title,usage_summary:'May help with '+title,used_turn:turn,benefit_type,usage_source:'actor_reported_helpfulness',...extra});

// Render the shipped plugin in a real React DOM. The native row follows the
// installed DSH MessageIconActions shape: Copy, slot, Branch, usage/time.
async function fixture({records={a:[]},events={a:[]},messages=['reply-1'],sessionId='a',showPanel=true}={}){
 const dom=new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',{url:'http://fixture.invalid'});
 const saved={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let definition,props={sessionId,messages},root;
 const slots=[],opened=[],cleanup=[],calls=[],sources=new Map();
 function source(id){
  if(!sources.has(id)){
   let entries=(events[id]||[]).map(event=>({event})),change={kind:'replace',entries};const listeners=new Set();
   sources.set(id,{getSnapshot:()=>({entries,change}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},emit(event,kind='append'){
    const entry={event};entries=kind==='replace'?[entry]:[...entries,entry];change={kind,entries:[entry]};for(const fn of listeners)fn();
   }});
  }
  return sources.get(id);
 }
 const api=async url=>{
  calls.push(url);const id=new URL(url,'http://fixture.invalid').searchParams.get('session_id');
  return {ok:true,json:async()=>url.includes('verified-memory')?{records:await(records[id]||[]),enabled:true}:{enabled:true}};
 };
 dom.window.__ModuleLoader__={load:d=>definition=d};
 runInNewContext(sourceCode,{window:dom.window,document:dom.window.document,fetch:api,setInterval,clearInterval,setTimeout,clearTimeout});
 const services={sessions:{binding:id=>({eventSource:source(id)})},sidebarRightTabs:{get:()=>({}),register:()=>()=>{}},sidebarRight:{openTabIn:(...args)=>opened.push(args)}};
 const ctx={get:name=>services[name],...services,effect:fn=>{const dispose=fn();if(typeof dispose==='function')cleanup.push(dispose)},locale:{register(){},bind:()=>()=>''},slots:{inject:(_name,fn)=>fn(),register:(opts,component)=>{slots.push({opts,component})}}};
 ctx.inject=(_deps,fn)=>fn(ctx);
 definition.factory(name=>name==='react'?React:{createPortal}).apply(ctx);
 const Action=slots.find(x=>x.opts.id==='evolith-memory-buff')?.component;
 assert.ok(Action,'per-assistant action slot is registered');
 const Toggle=slots.find(x=>x.opts.id==='evolith-mode').component;
 const Panel=slots.find(x=>x.opts.name==='sidebar.right.pane.tab').component;
 function App({sessionId,messages}){
  return React.createElement(React.Fragment,null,
   ...messages.map(messageId=>React.createElement('div',{'data-clock':'end','data-message':messageId,key:messageId},
    React.createElement('button',{'data-copy':true},'Copy'),
    React.createElement(Action,{sessionId,messageId}),
    React.createElement('button',{'data-branch':true},'Branch'),
    React.createElement('span',{'data-end-info':true},'Usage · time'))),
   React.createElement('div',{'data-composer':true},React.createElement(Toggle,{sessionId})),
   showPanel?React.createElement(Panel,{sessionId}):null);
 }
 root=createRoot(dom.window.document.querySelector('#root'));
 const settle=async()=>{await act(async()=>{await new Promise(resolve=>setImmediate(resolve))})};
 async function render(next={}){props={...props,...next};await act(async()=>{root.render(React.createElement(App,props))});await settle()}
 const row=id=>dom.window.document.querySelector('[data-message="'+id+'"]');
 const button=id=>row(id)?.querySelector('.dsh-evolith-benefit-trigger');
 const panel=()=>dom.window.document.querySelector('.dsh-evolith-verified-panel');
 await render();
 return {dom,records,slots,opened,calls,row,button,panel,render,settle,
  async emit(event,id=props.sessionId,kind='append'){await act(async()=>source(id).emit(event,kind));await settle()},
  async click(id){await act(async()=>button(id).click());await settle()},
  async cleanup(){await act(async()=>root.unmount());for(const fn of cleanup)fn();dom.window.close();globalThis.window=saved.window;globalThis.document=saved.document;globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act}
 };
}

for(const [type,label] of [['avoid_error','已触发避免问题'],['save_tool_calls','已触发节省调用'],['both','已触发避免问题和节省调用']]){
 test('per-turn '+type+' appears after Branch and before usage/time',async t=>{
  const f=await fixture({records:{a:[record(1,type)]},events:{a:[start(1),assistant(1,'reply-1'),end(1)]}});t.after(()=>f.cleanup());
  const button=f.button('reply-1');assert.ok(button);assert.equal(button.querySelector('[role="img"]').getAttribute('aria-label'),label);
  const anchor=button.parentElement;assert.equal(anchor.previousElementSibling.getAttribute('data-branch'),'true');assert.equal(anchor.nextElementSibling.getAttribute('data-end-info'),'true');
  assert.equal(f.row('reply-1').querySelectorAll('.dsh-evolith-benefit-trigger').length,1);
  assert.equal(f.dom.window.document.querySelector('[data-composer]').querySelector('.dsh-evolith-benefit-trigger'),null);
  assert.equal(f.opened.length,0,'opening history must not pop up the panel');
 });
}

test('each reply has its own benefits and click filters the already mounted panel to that exact turn',async t=>{
 const f=await fixture({records:{a:[record(1,'avoid_error','Earlier policy'),record(2,'save_tool_calls','Lookup shortcut'),record(8,'both','Other turn')]},events:{a:[start(1),assistant(1,'reply-1'),end(1),start(2),assistant(2,'reply-2'),end(2),start(3),assistant(3,'reply-3'),end(3)]},messages:['reply-1','reply-2','reply-3']});t.after(()=>f.cleanup());
 assert.equal(f.button('reply-1').querySelector('[role="img"]').getAttribute('aria-label'),'已触发避免问题');
 assert.equal(f.button('reply-2').querySelector('[role="img"]').getAttribute('aria-label'),'已触发节省调用');assert.equal(f.button('reply-3'),null);
 await f.click('reply-2');assert.match(f.panel().textContent,/第2轮用到的记忆/);assert.match(f.panel().textContent,/Lookup shortcut/);assert.doesNotMatch(f.panel().textContent,/Earlier policy|Other turn/);
 await f.click('reply-1');assert.match(f.panel().textContent,/第1轮用到的记忆/);assert.match(f.panel().textContent,/Earlier policy/);assert.doesNotMatch(f.panel().textContent,/Lookup shortcut|Other turn/);
});

test('legacy verified_turn records remain attached to their original reply',async t=>{
 const old=record(4,'avoid_error','Legacy memory',{used_turn:undefined,verified_turn:4,usage_source:'actor_verified_with_evidence'});
 const f=await fixture({records:{a:[old]},events:{a:[start(4),assistant(4,'reply-4'),end(4)]},messages:['reply-4']});t.after(()=>f.cleanup());
 await f.click('reply-4');assert.match(f.panel().textContent,/第4轮用到的记忆/);assert.match(f.panel().textContent,/Legacy memory/);
});

test('tool steps and synthetic memory messages never add business rounds',async t=>{
 const events=[start(9)];for(let i=0;i<18;i++)events.push(assistant(9,'tool-step-'+i,901+i));events.push(assistant(9,'reply-9',925),end(9,926));
 const f=await fixture({records:{a:[record(9,'both')]},events:{a:events},messages:['reply-9']});t.after(()=>f.cleanup());
 assert.equal(f.button('reply-9').getAttribute('aria-label'),'查看第9轮用到的记忆');await f.click('reply-9');assert.match(f.panel().textContent,/第9轮用到的记忆/);
});

test('no matching turn or unrecognized benefit does not show a misleading BUFF',async t=>{
 const f=await fixture({records:{a:[record(1,'unknown'),record(2,'both')]},events:{a:[start(1),assistant(1,'reply-1'),end(1)]},messages:['reply-1','missing-message']});t.after(()=>f.cleanup());
 assert.equal(f.button('reply-1'),null);assert.equal(f.button('missing-message'),null);
});

test('a late API response from another session cannot populate the current reply',async t=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const f=await fixture({records:{a:pending,b:[record(1,'save_tool_calls','B memory')]},events:{a:[start(1),assistant(1,'reply-1'),end(1)],b:[start(1),assistant(1,'reply-1'),end(1)]}});t.after(()=>f.cleanup());
 await f.render({sessionId:'b'});await act(async()=>release([record(1,'avoid_error','A memory')]));await f.settle();
 assert.equal(f.button('reply-1').querySelector('[role="img"]').getAttribute('aria-label'),'已触发节省调用');await f.click('reply-1');assert.match(f.panel().textContent,/B memory/);assert.doesNotMatch(f.panel().textContent,/A memory/);
});

test('live tool marking selects its turn and later history clicks can select an older turn',async t=>{
 const f=await fixture({records:{a:[record(1,'avoid_error','Old memory')]},events:{a:[start(1),assistant(1,'reply-1'),end(1)]},messages:['reply-1','reply-2']});t.after(()=>f.cleanup());
 await f.emit(start(2));await f.emit(assistant(2,'tool-call',201,[{type:'tool-call',id:'mark',name:'evolith_record_verified_memory'}]));
 f.records.a.push(record(2,'save_tool_calls','Live memory'));
 await f.emit({type:'tool/result',seq:202,data:{turn:2,message:{toolCallId:'mark',content:[{type:'text',text:JSON.stringify({recorded:true,status:'actor_reported_helpfulness',record_id:'live',benefit_type:'save_tool_calls'})}]}}});
 assert.equal(f.opened.length,1);assert.match(f.panel().textContent,/第2轮用到的记忆/);
 await f.emit(assistant(2,'reply-2',203));await f.emit(end(2,204));assert.ok(f.button('reply-2'));
 await f.click('reply-2');assert.match(f.panel().textContent,/Live memory/);assert.doesNotMatch(f.panel().textContent,/Old memory/);
 await f.click('reply-1');assert.match(f.panel().textContent,/Old memory/);assert.doesNotMatch(f.panel().textContent,/Live memory/);
});

test('unmount removes portal anchors and source reset clears a stale reply BUFF',async t=>{
 const f=await fixture({records:{a:[record(1,'both')]},events:{a:[start(1),assistant(1,'reply-1'),end(1)]}});t.after(()=>f.cleanup());
 assert.ok(f.button('reply-1'));await f.emit(start(2,500),'a','replace');assert.equal(f.button('reply-1'),null);assert.equal(f.dom.window.document.querySelectorAll('.dsh-evolith-turn-buff-anchor').length,0);
});
