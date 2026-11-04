import {mkdir,readFile,readdir,lstat,rm,rmdir} from 'node:fs/promises';import path from 'node:path';import writeFileAtomic from 'write-file-atomic';
import {workspacePath} from '../shared/workspace';
export interface BuildManifest{schemaVersion:1;kind:'labpad.build';owner:string;files:string[]}
export async function buildManifest(directory:string):Promise<BuildManifest|undefined>{
 try{const value=JSON.parse(await readFile(path.join(directory,'.labpad-build.json'),'utf8'));if(value?.schemaVersion===1&&value.kind==='labpad.build'&&typeof value.owner==='string'&&Array.isArray(value.files)){value.files.forEach(workspacePath);return value;}}catch(e:any){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}return undefined;
}
export async function prepareBuildDirectory(directory:string,owner:string,files:string[]){
 files.forEach(workspacePath);let existing=await buildManifest(directory);
 const info=await lstat(directory).catch((e:any)=>{if(e.code!=='ENOENT')throw e;return undefined;});
 if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw Error('构建位置不是普通文件夹：'+path.basename(directory));
 if(info&&(!existing||existing.owner!==owner))throw Error('build 文件夹已存在且不属于当前构建。请先重命名或移走该文件夹。');
 const owned=new Set(existing?.files??[]);
 for(const name of files)if(!owned.has(name)&&await lstat(path.join(directory,name)).catch(()=>undefined))throw Error('构建位置存在未管理文件：'+name+'。请先移走该文件。');
 await mkdir(directory,{recursive:true});
 const manifest:BuildManifest={schemaVersion:1,kind:'labpad.build',owner,files:[...new Set([...(existing?.files??[]),...files])]};
 await writeFileAtomic(path.join(directory,'.labpad-build.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
export async function cleanBuildDirectory(directory:string,owner:string){
 const manifest=await buildManifest(directory);if(!manifest||manifest.owner!==owner)throw Error('当前目录没有可清理的 LabPad 构建产物。');
 for(const name of manifest.files){
  let file=directory;for(const part of name.split('/')){file=path.join(file,part);const st=await lstat(file).catch(()=>undefined);if(st?.isSymbolicLink())throw Error('构建产物路径包含符号链接，已停止清理。');}
  await rm(path.join(directory,name),{force:true});
 }
 async function removeEmpty(dir:string){for(const e of await readdir(dir,{withFileTypes:true}))if(e.isDirectory()&&!e.isSymbolicLink())await removeEmpty(path.join(dir,e.name));if(dir!==directory)await rmdir(dir).catch((e:any)=>{if(!['ENOTEMPTY','EEXIST'].includes(e.code))throw e;});}
 await removeEmpty(directory);await writeFileAtomic(path.join(directory,'.labpad-build.json'),JSON.stringify({...manifest,files:[]},null,2)+'\n');
}
