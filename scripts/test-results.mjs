import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';

export function parseTap(text) {
  const result={};
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/);
    if(m)result[m[1]]=Number(m[2]);
  }
  for(const name of ['tests','pass','fail','cancelled','skipped'])if(!Number.isInteger(result[name]))throw Error('Node TAP footer missing: '+name);
  if(result.tests===0)throw Error('No unit tests were discovered');
  if(result.pass+result.fail+result.cancelled+result.skipped+ (result.todo||0)!==result.tests)throw Error('Inconsistent TAP totals');
  return {total:result.tests,passed:result.pass,failed:result.fail,cancelled:result.cancelled,skipped:result.skipped,todo:result.todo||0};
}
export function integrationCounts(report) {
  if(!report||typeof report.passed!=='boolean'||!Array.isArray(report.checks)||!report.checks.length)throw Error('BizAgent result is missing or empty');
  if(report.checks.some(c=>typeof c.passed!=='boolean'))throw Error('BizAgent check status is missing');
  const failed=report.checks.filter(c=>!c.passed).length;
  if(report.passed!==(failed===0))throw Error('BizAgent result disagrees with check statuses');
  return {total:report.checks.length,passed:report.checks.length-failed,failed,cancelled:0,skipped:0,todo:0};
}
export function commandPassed(execution,counts){return execution.code===0&&!execution.error&&!execution.timed_out&&(!counts||counts.failed+counts.cancelled===0);}
export function summarize(stages){
  const counts={total:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0};
  for(const stage of stages)if(stage.counts)for(const key of Object.keys(counts))counts[key]+=stage.counts[key]||0;
  return {passed:stages.some(s=>s.status==='passed')&&stages.every(s=>s.status==='passed'||s.status==='skipped'),counts,
    stages_passed:stages.filter(s=>s.status==='passed').length,stages_failed:stages.filter(s=>s.status==='failed').length,stages_skipped:stages.filter(s=>s.status==='skipped').length};
}
export async function runCommand(executable,args,{cwd,env,logPath,timeoutMs=120000}={}){
  const start=performance.now(),log=createWriteStream(logPath);let stdout='',stderr='',error,timed_out=false,killTimer;
  const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{stdout+=chunk;log.write(chunk)});
  child.stderr.on('data',chunk=>{stderr+=chunk;log.write(chunk)});
  const timer=setTimeout(()=>{timed_out=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000)},timeoutMs);
  child.on('error',e=>{error=e.message;log.write('\n'+e.stack+'\n')});
  const {code,signal}=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  clearTimeout(timer);clearTimeout(killTimer);
  await new Promise(resolve=>log.end(resolve));
  return {code,signal,error,timed_out,stdout,stderr,seconds:(performance.now()-start)/1000};
}
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderReport(report){
  const e=escapeHTML,label={passed:'通过',failed:'失败',skipped:'未运行'};
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evolith · 统一测试报告</title><style>body{font:15px/1.7 system-ui;background:#f5f7fb;color:#27364c;max-width:1020px;margin:40px auto;padding:0 20px}main{padding:30px;background:white;border-radius:16px}h1{font-size:27px}.passed{color:#087e56}.failed{color:#b42318}.skipped,small{color:#64748b}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #e4e9f1}a{color:#2463d3}pre{white-space:pre-wrap;font-size:12px}code{background:#f0f3f8;padding:2px 5px}</style><main><h1>Evolith · 统一测试报告</h1><p class="${report.passed?'passed':'failed'}">${report.passed?'通过':'失败'}${report.mode!=='all'?' · 按选项仅运行部分测试':''} · ${report.stages_passed}个阶段通过 / ${report.stages_failed}个阶段失败 / ${report.stages_skipped}个阶段未运行</p><p>${report.counts.passed}/${report.counts.total}项测试通过 · ${report.counts.failed}项失败 · ${report.counts.cancelled}项取消 · ${report.counts.skipped}项跳过 · 总用时 ${report.seconds.toFixed(2)}秒</p><p>插件 ${e(report.plugin_version)} · Node ${e(report.node_version)} · ${e(report.started_at)}</p><table><tr><th>阶段</th><th>结果</th><th>通过 / 测试数</th><th>耗时</th><th>证据</th></tr>${report.stages.map(s=>`<tr><td>${e(s.title)}${s.error?'<details><summary>说明</summary><pre>'+e(s.error)+'</pre></details>':''}</td><td class="${s.status}">${label[s.status]}</td><td>${s.counts?s.counts.passed+' / '+s.counts.total:'—'}</td><td>${s.seconds?.toFixed(2)||'—'}秒</td><td>${s.log?'<a href="'+e(s.log)+'">日志</a>':''}${s.report?' · <a href="'+e(s.report)+'">详情</a>':''}</td></tr>`).join('')}</table><p>BizAgent 是第22题已通过轨迹的固定回放：46轮对话、121次响应、209次业务工具调用。真实 DSH 内核及插件，本地模型/工具/Memory测试替身；不请求生产模型或记忆服务。前端覆盖消息隐藏的DOM/CSS，不等于完整Electron窗口端到端测试。</p><p><a href="report.json">JSON报告</a></p><small>${e(report.output)}</small></main></html>`;
}
