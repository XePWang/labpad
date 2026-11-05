import {readFile,readdir,lstat} from 'node:fs/promises';import path from 'node:path';
import {decodeText} from './storage';
import {workspacePath,uniquePaths,type WorkspaceSnapshot} from '../shared/workspace';
const sourceText=(name:string)=>name==='LPMake.txt'||/\.(?:c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(name);
export function snapshotBytes(entries:Record<string,Buffer>):WorkspaceSnapshot{
 const files:Record<string,string>={},binaryFiles:Record<string,string>={};
 for(const [name,bytes] of Object.entries(entries)){
  if(sourceText(name)&&(!bytes.includes(0)||(bytes[0]===255&&bytes[1]===254)||(bytes[0]===254&&bytes[1]===255))){files[name]=decodeText(bytes).text;continue;}
  try{const text=new TextDecoder('utf8',{fatal:true}).decode(bytes);if(bytes.includes(0)||!Buffer.from(text,'utf8').equals(bytes))throw Error('binary');files[name]=text;}
  catch{binaryFiles[name]=bytes.toString('base64');}
 }
 return {files,...(Object.keys(binaryFiles).length?{binaryFiles}:{})};
}
export function hasUnsavedSnapshotFiles(snapshot:WorkspaceSnapshot,buffers:{file?:string;source:string}[]){
 for(const {file,source}of buffers){
  if(!file)continue;
  if(Object.hasOwn(snapshot.files,file)){if(snapshot.files[file]!==source)return true;}
  else if(Object.hasOwn(snapshot.binaryFiles??{},file)&&decodeText(Buffer.from(snapshot.binaryFiles![file],'base64')).text!==source)return true;
 }
 return false;
}

export function snapshotEntries(snapshot:WorkspaceSnapshot):Record<string,Buffer>{
 uniquePaths([...Object.keys(snapshot.files),...Object.keys(snapshot.binaryFiles??{})].filter(name=>name!=='labpad.project.json'));
 const entries=Object.fromEntries(Object.entries(snapshot.files).map(([name,text])=>[name,Buffer.from(text,'utf8')]));
 for(const [name,base64]of Object.entries(snapshot.binaryFiles??{})){if(Object.hasOwn(entries,name))throw Error('文件同时具有文本和二进制内容：'+name);entries[name]=Buffer.from(base64,'base64');}
 return entries;
}
export async function managedBuild(dir:string){
 try{const value=JSON.parse(await readFile(path.join(dir,'.labpad-build.json'),'utf8'));return value?.kind==='labpad.build'&&value.schemaVersion===1;}catch{return false;}
}
export async function directorySnapshot(root:string):Promise<WorkspaceSnapshot>{
 const entries:Record<string,Buffer>={};let bytes=0;
 async function walk(dir:string,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){
  const name=prefix+e.name;
  if(e.name==='.git'||e.name==='.work'||e.name==='.labpad'||e.name==='.labpad-project.json'||e.name==='.labpad-candidate.json'||e.name.startsWith('.labpad-txn-'))continue;
  if(e.isSymbolicLink())throw Error('项目中存在符号链接：'+name);
  if(e.isDirectory()){if(!await managedBuild(path.join(dir,e.name)))await walk(path.join(dir,e.name),name+'/');}
  else if(e.isFile()){
   if(name!=='labpad.project.json')workspacePath(name);
   const st=await lstat(path.join(dir,e.name));if(st.size>8*1024**2||(bytes+=st.size)>64*1024**2||Object.keys(entries).length>=4096)throw Error('项目超过4096项 / 64MB限制');
   entries[name]=await readFile(path.join(dir,e.name));
  }
 }}
 await walk(root);uniquePaths(Object.keys(entries).filter(n=>n!=='labpad.project.json'));return snapshotBytes(entries);
}
