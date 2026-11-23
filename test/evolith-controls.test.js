import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

async function controls() {
  let definition,Toggle,cursor=0,timeout;
  const cells=[],calls=[];
  const react={
    createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState(initial){const i=cursor++;if(!(i in cells))cells[i]=i===1?false:initial;return[cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value}]},
    useRef(initial){const i=cursor++;if(!(i in cells))cells[i]={current:initial};return cells[i]},
    useId:()=> 'evolith-help-test', useEffect(){},useLayoutEffect(){}
  };
  runInNewContext(await readFile(new URL('../client.js',import.meta.url),'utf8'),{
    window:{__ModuleLoader__:{load:value=>definition=value}},
    document:{body:{},createElement:()=>({dataset:{},remove(){}}),head:{appendChild(){}}},
    setTimeout:fn=>{timeout=fn;return 1},clearTimeout:()=>{timeout=null},
    fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({})}}
  });
  definition.factory(name=>name==='react'?react:{createPortal:(child)=>({type:'portal',props:{},children:[child]})}).apply({
    effect:fn=>fn(),locale:{register(){},bind:()=>()=> '记忆'},
    slots:{inject:(_,fn)=>fn(),register:(options,component)=>{if(options.id==='evolith-mode')Toggle=component}}
  });
  const render=()=>{cursor=0;return Toggle({sessionId:'fixture-session'})};
  const nodes=tree=>tree&&typeof tree==='object'?[tree,...tree.children.flatMap(nodes)]:[];
  const text=tree=>tree&&typeof tree==='object'?tree.children.map(text).join(''):String(tree??'');
  return{render,nodes,text,calls,leave:()=>timeout?.()};
}

test('Evolith uses an accessible compact switch and a vector help button',async()=>{
  const f=await controls(),all=f.nodes(f.render());
  const toggle=all.find(n=>n.props.role==='switch'),help=all.find(n=>n.props['aria-label']==='Evolith 模式说明');
  assert.equal(toggle.type,'button');assert.equal(toggle.props['aria-checked'],false);
  assert.ok(!all.some(n=>n.type==='input'&&n.props.type==='checkbox'));
  assert.equal(help.type,'button');assert.ok(f.nodes(help).some(n=>n.type==='svg'));
  assert.equal(help.props.title,undefined);
});

test('hover and keyboard focus open a portal containing the complete privacy explanation',async()=>{
  const f=await controls();
  f.nodes(f.render()).find(n=>n.props['aria-label']==='Evolith 模式说明').props.onMouseEnter();
  let tree=f.render(),all=f.nodes(tree);
  assert.ok(all.some(n=>n.type==='portal'));
  const tip=all.find(n=>n.props.role==='tooltip');
  assert.equal(tip.props.id,'evolith-help-test');
  assert.match(f.text(tip),/用户消息、模型回复和工具结果/);
  assert.match(f.text(tip),/发送至你配置的服务端/);
  assert.match(f.text(tip),/关闭后不接入/);
  const help=all.find(n=>n.props['aria-label']==='Evolith 模式说明');
  assert.equal(help.props['aria-describedby'],tip.props.id);
  help.props.onMouseLeave();f.leave();
  assert.ok(!f.nodes(f.render()).some(n=>n.props.role==='tooltip'));
  f.nodes(f.render()).find(n=>n.props['aria-label']==='Evolith 模式说明').props.onFocus();
  assert.ok(f.nodes(f.render()).some(n=>n.props.role==='tooltip'));
  assert.equal(f.calls.length,0); // Help never changes consent or uploads data.
});

test('the new switch persists the selected state through the same local consent API',async()=>{
  const f=await controls();
  await f.nodes(f.render()).find(n=>n.props.role==='switch').props.onClick();
  assert.equal(f.nodes(f.render()).find(n=>n.props.role==='switch').props['aria-checked'],true);
  assert.equal(f.calls[0].options.method,'PUT');
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{enabled:true});
  await f.nodes(f.render()).find(n=>n.props.role==='switch').props.onClick();
  assert.deepEqual(JSON.parse(f.calls[1].options.body),{enabled:false});
});

test('keyboard focus keeps the help card open when the mouse leaves, then blur closes it',async()=>{
  const f=await controls();
  let help=f.nodes(f.render()).find(n=>n.props['aria-label']==='Evolith 模式说明');
  help.props.onMouseEnter();help.props.onFocus();help.props.onMouseLeave();f.leave();
  assert.ok(f.nodes(f.render()).some(n=>n.props.role==='tooltip'));
  help=f.nodes(f.render()).find(n=>n.props['aria-label']==='Evolith 模式说明');
  help.props.onBlur();f.leave();
  assert.ok(!f.nodes(f.render()).some(n=>n.props.role==='tooltip'));
});
