import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseTap,integrationCounts,commandPassed,summarize,runCommand,renderReport} from '../scripts/test-results.mjs';

test('unified runner reads the final TAP totals rather than nested suite totals',()=>{
  const counts=parseTap('    # tests 99\n    # pass 99\n# tests 4\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n');
  assert.deepEqual(counts,{total:4,passed:2,failed:1,cancelled:0,skipped:1,todo:0});
  assert.equal(commandPassed({code:0},counts),false);
});
test('missing, empty and inconsistent test output cannot be reported as green',()=>{
  for(const text of ['', '# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0', '# tests 3\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0'])assert.throws(()=>parseTap(text));
  for(const report of [{passed:true,checks:[]},{passed:true,checks:[{passed:false}]},{passed:true,checks:[{}]}])assert.throws(()=>integrationCounts(report));
});
test('nonzero exit and timeout take precedence over optimistic test summaries',()=>{
  const good={total:3,passed:3,failed:0,cancelled:0,skipped:0};
  assert.equal(commandPassed({code:1},good),false);
  assert.equal(commandPassed({code:0,timed_out:true},good),false);
  assert.equal(commandPassed({code:0,error:'spawn failed'},good),false);
  const result=summarize([{status:'passed',counts:good},{status:'failed',error:'Result file missing'},{status:'skipped'}]);
  assert.equal(result.passed,false);assert.equal(result.stages_failed,1);assert.equal(result.stages_skipped,1);assert.equal(result.counts.total,3);
});
test('result page marks partial runs and escapes error details',()=>{
  const html=renderReport({passed:false,mode:'unit',stages_passed:0,stages_failed:1,stages_skipped:2,counts:{passed:0,total:1,failed:1,cancelled:0,skipped:0},seconds:1,stages:[{title:'<script>alert(1)</script>',status:'failed',error:'<img src=x onerror=x>',log:'unit.log',seconds:1}]});
  assert.ok(html.includes('仅运行部分测试'));assert.ok(!html.includes('<script>alert'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('unit.log'));
});
test('a failing child retains its logs and fails the pipeline',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'evolith-runner-test-'));
  try{const file=join(dir,'child.log');const result=await runCommand(process.execPath,['-e','console.error("retained failure evidence");process.exit(7)'],{logPath:file,env:process.env,timeoutMs:5000});assert.equal(result.code,7);assert.equal(commandPassed(result),false);assert.match(await readFile(file,'utf8'),/retained failure evidence/)}finally{await rm(dir,{recursive:true,force:true})}
});
test('a stuck test child is terminated and recorded as timeout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'evolith-runner-timeout-'));
  try{const result=await runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{logPath:join(dir,'hang.log'),env:process.env,timeoutMs:100});assert.equal(result.timed_out,true);assert.equal(commandPassed(result),false)}finally{await rm(dir,{recursive:true,force:true})}
});
