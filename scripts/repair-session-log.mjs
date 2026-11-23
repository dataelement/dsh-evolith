// Explicit, offline repair. Close Desktop first; default mode validates without writing.
import {readFile,writeFile,mkdir,copyFile,stat,open,rename,unlink,mkdtemp,rm} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {zstdCompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
// Desktop logs contain concatenated frames. Decode every frame, not only the first.
const decompress=bytes=>execFileSync(process.env.DSH_ZSTD||'zstd',['-d','-c'],{input:bytes,maxBuffer:256*1024*1024});
import {repairPruneRecords} from './repair-prune-records.mjs';

const args=process.argv.slice(2),values={};let apply=false;
for(let i=0;i<args.length;i++){
  if(args[i]==='--apply')apply=true;
  else if(['--file','--report','--backup-dir'].includes(args[i])&&args[i+1])values[args[i].slice(2)]=resolve(args[++i]);
  else throw Error('Usage: repair-session-log.mjs --file LOG --report JSON [--apply --backup-dir DIR]');
}
if(!values.file||!values.report||apply&&!values['backup-dir'])throw Error('A file and report are required; applying also requires backup-dir');
const root=process.env.DSH_KERNEL_ROOT||'/Applications/DSH Desktop.app/Contents/Resources/app.asar/node_modules';
const {sessionFormatCatalog}=await import(pathToFileURL(join(root,'@deepseek-ai/dsh-session-format-catalog/lib/index.js')));
const {Session}=await import(pathToFileURL(join(root,'@deepseek-ai/dsh-session/lib/index.js')));
const {Context}=await import(pathToFileURL(join(root,'@deepseek-ai/cordis/lib/index.js')));
const persistence=await import(pathToFileURL(join(root,'@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')));
const hash=data=>createHash('sha256').update(data).digest('hex');
function restore(rows){
  const reader=sessionFormatCatalog.createRestore(rows[0],{recovery:'strict',validation:'current'});
  for(const row of rows.slice(1))reader.decodeRow(row);
  const artifact=reader.finish();
  return Session.create(artifact.header.id,artifact.events,artifact.header,artifact.inheritedEventCount);
}
async function validateNativeFile(bytes,session,expectedCount){
  const temporary=await mkdtemp(join(tmpdir(),'evolith-repair-validate-')),context=new Context();
  try{
    await context.plugin(persistence,{root:temporary,compression:'zstd',listConcurrency:3});
    const file=context.sessionPersistence.locate(session.header).path;
    await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes);
    const handle=await context.sessionPersistence.open(session.id,'read');
    try{
      const result=await handle.read();
      if(!isDeepStrictEqual(result.events,session.snapshotEvents(0,expectedCount)))throw Error('Native persistence changed or lost historical events');
    }finally{await handle.close()}
  }finally{await context.fiber.dispose();await rm(temporary,{recursive:true,force:true})}
}
const bytes=await readFile(values.file),metadata=await stat(values.file),beforeHash=hash(bytes);
const original=decompress(bytes).toString('utf8');
const lines=original.trimEnd().split('\n'),rows=lines.map(line=>JSON.parse(line));
let originalError;try{restore(rows)}catch(error){originalError=error.message}
const repaired=repairPruneRecords(rows);
const restored=restore(repaired.rows);
const result={mode:apply?'applied':'validated_only',session_id:rows[0].id,file:values.file,before_sha256:beforeHash,record_count:rows.length,original_error:originalError||null,changes:repaired.changes.map(c=>({seq:c.seq,shadowed_count:c.shadowedSeqs.length})),validation:'installed native codec, strict current-format admission and Session surface restoration',surface_nodes:restored.surface.nodes.length};
if(repaired.changes.length){
  const changed=new Set(repaired.changes.map(c=>c.seq));
  const outputLines=repaired.rows.map((row,index)=>row.type==='compaction/prune'&&changed.has(row.seq)?JSON.stringify(row):lines[index]);
  // The native JSONL backend requires an independently decodable header-only frame.
  const compressed=Buffer.concat([zstdCompressSync(Buffer.from(outputLines[0]+'\n')),zstdCompressSync(Buffer.from(outputLines.slice(1).join('\n')+'\n'))]);
  restore(decompress(compressed).toString().trimEnd().split('\n').map(line=>JSON.parse(line)));
  await validateNativeFile(compressed,restored,rows.length-1);
  result.native_persistence_read=true;
  result.after_sha256=hash(compressed);
  if(apply){
    const backupDir=values['backup-dir'];await mkdir(backupDir,{recursive:true,mode:0o700});
    result.backup=join(backupDir,basename(values.file));
    await copyFile(values.file,result.backup,1);
    if(hash(await readFile(result.backup))!==beforeHash)throw Error('Backup checksum mismatch');
    if(hash(await readFile(values.file))!==beforeHash)throw Error('Source changed during validation; refusing repair');
    const temporary=values.file+'.repair-'+process.pid;
    try{
      const handle=await open(temporary,'wx',metadata.mode&0o777);
      try{await handle.writeFile(compressed);await handle.sync()}finally{await handle.close()}
      if(hash(await readFile(values.file))!==beforeHash)throw Error('Source changed before replacement; refusing repair');
      await rename(temporary,values.file);
      const directory=await open(dirname(values.file),'r');try{await directory.sync()}finally{await directory.close()}
      const final=await readFile(values.file);if(hash(final)!==result.after_sha256)throw Error('Repaired file checksum mismatch');
      restore(decompress(final).toString().trimEnd().split('\n').map(line=>JSON.parse(line)));
      await validateNativeFile(final,restored,rows.length-1);
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}
  }
}else{await validateNativeFile(bytes,restored,rows.length-1);result.native_persistence_read=true}
await mkdir(dirname(values.report),{recursive:true});await writeFile(values.report,JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result));
