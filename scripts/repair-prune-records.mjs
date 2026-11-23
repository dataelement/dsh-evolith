import {isDeepStrictEqual} from 'node:util';

// Only reconstruct a missing field when the following replacement is its exact witness.
// Physical sourceEventSeqs may use inclusive range pairs; shadowedSeqs never does.
export function repairPruneRecords(rows) {
  const changes=[];
  const repaired=rows.map((row,index)=>{
    if(row.type!=='compaction/prune'||row.data?.reason!=='token-saving-window'||Object.hasOwn(row.data,'shadowedSeqs'))return row;
    const next=rows[index+1],range=row.data.shadowedRange;
    if(next?.type!=='user/message'||next.seq!==row.seq+1||!next.data?.id?.startsWith('dsh-window-pruned:')||
      next.surfaceOp?.op!=='replace'||next.surfaceOp.startSeq!==range?.start||next.surfaceOp.endSeq!==range?.end||!Array.isArray(next.sourceEventSeqs))
      throw Error(`Cannot safely reconstruct prune at seq ${row.seq}: missing exact replacement witness`);
    const seqs=[];
    for(const value of next.sourceEventSeqs){
      const start=Array.isArray(value)?value[0]:value,end=Array.isArray(value)?value[1]:value;
      if(Array.isArray(value)&&value.length!==2||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=row.seq||seqs.length+end-start+1>row.seq)
        throw Error(`Invalid source sequence at prune ${row.seq}`);
      for(let seq=start;seq<=end;seq++)seqs.push(seq);
    }
    if(!seqs.length||new Set(seqs).size!==seqs.length||seqs[0]!==range.start||seqs.at(-1)!==range.end)
      throw Error(`Replacement span disagrees with prune ${row.seq}`);
    changes.push({seq:row.seq,shadowedSeqs:seqs});
    return {...row,data:{...row.data,shadowedSeqs:seqs}};
  });
  // Preserve every field other than the newly added witness.
  for(const [index,row] of repaired.entries()){
    if(row===rows[index])continue;
    const {shadowedSeqs,...data}=row.data;
    if(!isDeepStrictEqual({...row,data},rows[index]))throw Error('Repair altered unrelated data');
  }
  return {rows:repaired,changes};
}
