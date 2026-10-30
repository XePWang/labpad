import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {decodeText,exists,readJSON} from '../core/storage';
import type {Intake,Candidate} from './collect';

/** Keep complete received versions across reruns, including overwritten intake names. */
export async function retainVersions(lab:string,labId:string,students:string[],problems:string[],intake:Intake){
 const index=path.join(lab,'src/index.json'),raw=await exists(index)?await readJSON(index):[];
 if(!Array.isArray(raw))throw Error('源码索引格式无效，请检查 src/index.json');
 const history=new Map<string,Omit<Candidate,'source'>>(),active=new Map<string,Candidate>();let ordinal=0;
 for(const [i,value] of raw.entries()){
  const record=value as Omit<Candidate,'source'>;
  if(!record||typeof record.key!=='string'||typeof record.file!=='string'||typeof record.origin!=='string'||typeof record.studentId!=='string'||!/^\d+$/.test(record.studentId)||typeof record.problemId!=='string'||!/^[0-9a-f]{64}$/.test(record.hash)||!['c','cpp'].includes(record.language))throw Error('源码索引记录无效，请检查 src/index.json');
  if(history.has(record.key))throw Error('源码索引包含重复版本，请检查 src/index.json');
  const saved={...record,labId:record.labId??labId,ordinal:Number.isSafeInteger(record.ordinal)&&record.ordinal!>0?record.ordinal!:i+1};
  ordinal=Math.max(ordinal,saved.ordinal);history.set(saved.key,saved);
  if(saved.labId!==labId||!students.includes(saved.studentId)||!problems.includes(saved.problemId))continue;
  const file=path.resolve(lab,saved.file),relative=path.relative(path.join(lab,'src'),file);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('源码索引路径超出 src：'+saved.file);
  try{
   const source=decodeText(await readFile(file)).text,hash=createHash('sha256').update(source,'utf8').digest('hex');
   if(hash!==saved.hash)throw Error('内容与记录不一致');
   active.set(saved.key,{...saved,source});
  }catch{
   intake.issues.push({origin:saved.origin,message:'已收录的源码版本无法读取或校验失败：'+saved.file,students:[saved.studentId],problemId:saved.problemId,pending:true});
  }
 }
 for(const candidate of intake.candidates){
  const previous=history.get(candidate.key),version={...candidate,labId,ordinal:previous?.ordinal??++ordinal};
  const {source,...metadata}=version;history.set(version.key,metadata);active.set(version.key,version);
 }
 intake.candidates=[...active.values()].sort((a,b)=>(a.ordinal??0)-(b.ordinal??0)||a.key.localeCompare(b.key));
 return [...history.values()].sort((a,b)=>(a.ordinal??0)-(b.ordinal??0)||a.key.localeCompare(b.key));
}
