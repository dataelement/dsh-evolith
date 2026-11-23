import test from 'node:test';
import assert from 'node:assert/strict';
import {repairPruneRecords} from '../scripts/repair-prune-records.mjs';

function fixture(){return [{type:'compaction/prune',seq:20,time:1,data:{shadowedRange:{start:3,end:12},shadowedTokenCount:90,reason:'token-saving-window'}},{type:'user/message',seq:21,time:2,data:{id:'dsh-window-pruned:fixture',content:[{type:'text',text:'Window moved'}]},surfaceOp:{op:'replace',startSeq:3,endSeq:12},sourceEventSeqs:[[3,5],9,12]}]}
test('repair only adds exact shadowed sequences and is idempotent',()=>{
  const rows=fixture(),before=structuredClone(rows),result=repairPruneRecords(rows);
  assert.deepEqual(rows,before);assert.deepEqual(result.rows[0].data.shadowedSeqs,[3,4,5,9,12]);
  assert.equal(result.rows[1],rows[1]);assert.equal(result.rows[0].seq,20);assert.equal(result.rows[0].time,1);
  assert.equal(repairPruneRecords(result.rows).changes.length,0);
});
test('repair uses surface order even when replacement sequence exceeds older end sequence',()=>{
  const rows=fixture();rows[0].data.shadowedRange={start:18,end:5};Object.assign(rows[1].surfaceOp,{startSeq:18,endSeq:5});rows[1].sourceEventSeqs=[18,3,5];
  assert.deepEqual(repairPruneRecords(rows).rows[0].data.shadowedSeqs,[18,3,5]);
});
test('repair refuses missing, unrelated, conflicting or malformed witnesses',()=>{
  const mutations=[rows=>rows.pop(),rows=>rows[1].data.id='ordinary-user',rows=>rows[1].surfaceOp.endSeq=8,rows=>rows[1].sourceEventSeqs=[3,3,12],rows=>rows[1].sourceEventSeqs=[[3,21]],rows=>rows[1].sourceEventSeqs=[[3,5,7]],rows=>rows[1].sourceEventSeqs=[3,9]];
  for(const mutate of mutations){const rows=fixture();mutate(rows);assert.throws(()=>repairPruneRecords(rows));}
});
test('repair leaves existing fields and non-Evolith records untouched for strict native validation',()=>{
  const rows=fixture();rows[0].data.shadowedSeqs=null;assert.equal(repairPruneRecords(rows).changes.length,0);
  delete rows[0].data.shadowedSeqs;rows[0].data.reason='native-prune';assert.equal(repairPruneRecords(rows).changes.length,0);
});
