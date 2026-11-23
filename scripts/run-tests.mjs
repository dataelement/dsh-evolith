import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseTap,integrationCounts,commandPassed,summarize,runCommand,renderReport} from './test-results.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const flags=process.argv.slice(2);
if(flags.some(x=>!['--unit','--bizagent'].includes(x))||flags.length>1){console.error('Usage: npm test [-- --unit | -- --bizagent]');process.exit(2)}
const mode=flags[0]?.slice(2)||'all';
const started=performance.now(),startedAt=new Date().toISOString();
const outputRoot=resolve(process.env.DSH_TEST_RESULTS||join(root,'test-results'));
const runId=startedAt.replace(/[:.]/g,'-')+'-'+process.pid,output=join(outputRoot,runId);
await mkdir(output,{recursive:true});
const version=JSON.parse(await readFile(join(root,'package.json'))).version;
const kernel=process.env.DSH_KERNEL_ROOT||'/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules';
const report={schema_version:1,started_at:startedAt,mode,plugin_version:version,node_version:process.version,kernel,output,stages:[]};
const baseEnv={...process.env,ELECTRON_RUN_AS_NODE:process.env.ELECTRON_RUN_AS_NODE||'1'};
const unitFiles=(await readdir(join(root,'test'))).filter(x=>x.endsWith('.test.js')).sort().map(x=>join(root,'test',x));
console.log(`Evolith ${version} · ${mode==='all'?'完整测试':mode+' 部分测试'}`);
console.log('报告目录：'+output);

async function stage(id,title,enabled,work){
  if(!enabled){report.stages.push({id,title,status:'skipped',error:'Not selected by --'+mode});console.log('未运行 '+title);return}
  console.log('运行中 '+title);const start=performance.now();
  const row={id,title,status:'failed',log:id+'.log'};report.stages.push(row);
  try{await work(row);row.status='passed'}catch(error){row.error=error.stack||String(error);await writeFile(join(output,id+'.error.txt'),row.error+'\n')}
  row.seconds=(performance.now()-start)/1000;
  console.log(`${row.status==='passed'?'通过':'失败'} ${title}${row.counts?' · '+row.counts.passed+'/'+row.counts.total:''} · ${row.seconds.toFixed(2)}秒`);
  if(row.error)console.error('  '+row.error.split('\n')[0]+'；详见 '+join(output,row.log));
}
async function syntaxFiles(dir){const out=[];for(const entry of await readdir(join(root,dir),{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())out.push(...await syntaxFiles(p));else if(/\.(?:js|mjs)$/.test(entry.name))out.push(p)}return out}
await stage('syntax','代码语法检查',mode!=='bizagent',async row=>{
  const files=['index.js','client.js',...await syntaxFiles('src'),...await syntaxFiles('static'),...await syntaxFiles('scripts'),...await syntaxFiles('test'),...await syntaxFiles('tests')];
  const lines=[];
  for(const file of files){const result=await runCommand(process.execPath,['--check',join(root,file)],{cwd:root,env:baseEnv,logPath:join(output,'syntax-current.log'),timeoutMs:10000});lines.push(file+' '+(result.code===0?'PASS':'FAIL')+'\n'+result.stdout+result.stderr);if(!commandPassed(result)){await writeFile(join(output,row.log),lines.join('\n'));throw Error('Syntax check failed: '+file)}}
  await writeFile(join(output,row.log),lines.join('\n'));row.files=files.length;
});
await stage('unit','插件单元测试',mode!=='bizagent',async row=>{
  const result=await runCommand(process.execPath,['--test','--test-reporter=tap',...unitFiles],{cwd:root,env:{...baseEnv,DSH_EVOLITH_TEST_KERNEL_ROOT:''},logPath:join(output,row.log)});
  row.counts=parseTap(result.stdout);row.exit_code=result.code;
  if(!commandPassed(result,row.counts))throw Error(`Unit tests failed (exit ${result.code}, timeout ${result.timed_out})`);
});
await stage('native','当前DSH内核兼容测试',mode==='all',async row=>{
  const result=await runCommand(process.execPath,['--test','--test-reporter=tap',join(root,'test/evolith-runtime.test.js')],{cwd:root,env:{...baseEnv,DSH_EVOLITH_TEST_KERNEL_ROOT:kernel},logPath:join(output,row.log)});
  row.counts=parseTap(result.stdout);row.exit_code=result.code;
  if(!commandPassed(result,row.counts))throw Error(`Installed-kernel tests failed (exit ${result.code}, timeout ${result.timed_out})`);
});
await stage('bizagent','BizAgent第22题集成回放',mode!=='unit',async row=>{
  const sub=join(output,'bizagent');row.report='bizagent/index.html';
  const result=await runCommand(process.execPath,[join(root,'tests/integration/bizagent/run.mjs')],{cwd:root,env:{...baseEnv,DSH_BRIDGE_ROOT:root,DSH_KERNEL_ROOT:kernel,DSH_TEST_OUTPUT:sub},logPath:join(output,row.log),timeoutMs:120000});
  row.exit_code=result.code;
  const child=JSON.parse(await readFile(join(sub,'report.json'),'utf8'));row.counts=integrationCounts(child);
  if(!commandPassed(result,row.counts))throw Error(`BizAgent regression failed (exit ${result.code}, timeout ${result.timed_out})`);
});
Object.assign(report,summarize(report.stages),{seconds:(performance.now()-started)/1000,finished_at:new Date().toISOString()});
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(join(output,'index.html'),renderReport(report));
await writeFile(join(outputRoot,'latest.json'),JSON.stringify({output,report:join(output,'index.html'),passed:report.passed,mode,finished_at:report.finished_at},null,2)+'\n');
await writeFile(join(outputRoot,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./${runId}/index.html"><a href="./${runId}/index.html">查看最新测试报告</a>`);
console.log(`\n${report.passed?'测试通过':'测试失败'}：${report.counts.passed}/${report.counts.total}项通过，${report.counts.failed}项失败，${report.counts.cancelled}项取消，${report.stages_failed}个阶段失败，${report.stages_skipped}个阶段未运行。`);
console.log('结果页：'+join(output,'index.html'));
console.log('JSON：'+join(output,'report.json'));
process.exitCode=report.passed?0:1;
