import {access,readdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {runProcess} from './process';
import {defaultCompilerConfig} from '../shared/defaults';
import type {CompilerConfig,DetectedCompiler} from '../shared/types';

export function compilerEnvironment(base:NodeJS.ProcessEnv,config:CompilerConfig):NodeJS.ProcessEnv{
 const env={...base};
 if(config.mode==='custom'){
  const key=Object.keys(env).find(k=>k.toLowerCase()==='path')??'PATH';
  const bins=[...new Set([config.cPath,config.cppPath].filter(Boolean).map(file=>path.dirname(file)))];
  env[key]=[...bins,env[key]??''].filter(Boolean).join(path.delimiter);
 }
 return env;
}
export function compilerSearchDirectories(platform=process.platform,env:NodeJS.ProcessEnv=process.env,home=homedir()):string[]{
 const p=platform==='win32'?path.win32:path.posix,key=Object.keys(env).find(k=>k.toLowerCase()==='path')??'PATH';
 const directories=(env[key]??'').split(platform==='win32'?';':':').map(s=>s.trim().replace(/^"|"$/g,'')).filter(s=>p.isAbsolute(s));
 if(platform==='win32'){
  const drive=env.SystemDrive||'C:',local=env.LOCALAPPDATA||p.join(home,'AppData','Local');
  const programs=[env.ProgramFiles||p.join(drive,'Program Files'),env['ProgramFiles(x86)']||p.join(drive,'Program Files (x86)')];
  for(const base of programs)directories.push(p.join(base,'CodeBlocks','MinGW','bin'),p.join(base,'LLVM','bin'),p.join(base,'zig'));
  for(const base of [drive,local])for(const name of ['msys64','msys32'])for(const variant of ['ucrt64','mingw64','mingw32','clang64'])directories.push(p.join(base,name,variant,'bin'));
  directories.push(p.join(drive,'MinGW','bin'),p.join(drive,'mingw64','bin'),p.join(drive,'zig'),p.join(local,'Microsoft','WinGet','Links'));
  for(const base of [p.join(home,'scoop'),p.join(env.ProgramData||p.join(drive,'ProgramData'),'scoop')])
   for(const name of ['gcc','llvm','zig'])directories.push(p.join(base,'apps',name,'current','bin'),p.join(base,'apps',name,'current'));
 }else{
  directories.push('/usr/bin','/usr/local/bin','/opt/bin',p.join(home,'.local','bin'));
  if(platform==='darwin')directories.push('/opt/homebrew/bin','/opt/homebrew/opt/llvm/bin','/usr/local/opt/llvm/bin','/Library/Developer/CommandLineTools/usr/bin','/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin');
  if(platform==='linux'){
   directories.push('/usr/lib/llvm/bin','/opt/zig');
   for(let version=14;version<=23;version++)directories.push('/usr/lib/llvm-'+version+'/bin');
  }
 }
 return [...new Map(directories.map(dir=>[platform==='win32'?p.normalize(dir).toLowerCase():p.normalize(dir),p.normalize(dir)])).values()];
}
export interface DetectionOptions{cwd:string;env?:NodeJS.ProcessEnv;directories?:string[];exclude?:string[];processHost?:string}
export async function detectCompilers(options:DetectionOptions):Promise<DetectedCompiler[]>{
 const env=options.env??process.env,dirs=options.directories??compilerSearchDirectories(process.platform,env);
 const excluded=await Promise.all((options.exclude??[]).map(file=>realpath(file).catch(()=>path.resolve(file))));
 const insideExcluded=(file:string)=>excluded.some(dir=>{const relative=path.relative(dir,file);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));});
 const candidates:{file:string;base:string;suffix:string;ext:string}[]=[],seen=new Set<string>();
 for(const directory of dirs){
  let names:string[];try{names=await readdir(directory);}catch{continue;}
  for(const name of names.sort()){
   const match=/^(gcc|cc|clang|zig)(-\d+(?:\.\d+)*)?(\.exe)?$/i.exec(name);
   if(!match||(process.platform==='win32'&&!match[3]))continue;
   const file=path.join(directory,name);
   try{
    await access(file,constants.X_OK);const identity=await realpath(file),key=process.platform==='win32'?identity.toLowerCase():identity;
    if(insideExcluded(identity)||seen.has(key))continue;seen.add(key);
    candidates.push({file,base:match[1].toLowerCase(),suffix:match[2]??'',ext:match[3]??''});
   }catch{}
  }
 }
 async function command(file:string,args:string[],profile:CompilerConfig){
  const r=await runProcess(file,args,{cwd:options.cwd,timeLimitMs:3000,outputLimitBytes:32768,env:compilerEnvironment(env,profile),processHost:options.processHost});
  return r.reason||r.code!==0?'':r.stdout.toString('utf8')+r.stderr.toString('utf8');
 }
 async function probe(candidate:typeof candidates[number]):Promise<DetectedCompiler|null>{
  const {file,base,suffix,ext}=candidate;
  try{
   const preliminary={...defaultCompilerConfig(base==='zig'?'zig':'gcc'),mode:'custom' as const,cPath:file};
   const output=await command(file,base==='zig'?['version']:['--version'],preliminary);
   const kind:CompilerConfig['kind']|undefined=base==='zig'&&/^\d+\.\d+\.\d+/.test(output.trim())?'zig':/clang version|Apple (?:LLVM|clang)/i.test(output)?'clang':/gcc|Free Software Foundation/i.test(output)?'gcc':undefined;
   if(!kind)return null;
   let target=/^Target:\s*(.+)$/mi.exec(output)?.[1].trim()??'';
   if(kind!=='zig'&&!target)target=(await command(file,['-dumpmachine'],preliminary)).trim().split(/\r?\n/)[0]??'';
   const compiler={...defaultCompilerConfig(kind,/windows-msvc|pc-windows-msvc/i.test(target)),mode:'custom' as const,cPath:file};
   if(kind==='zig')compiler.cppPath=file;
   else{
    const paired=base==='gcc'?'g++':base==='cc'?'c++':'clang++';
    for(const name of [...new Set([paired+suffix+ext,(kind==='clang'?'clang++':'g++')+suffix+ext])]){
     const cpp=path.join(path.dirname(file),name);
     try{
      await access(cpp,constants.X_OK);const version=await command(cpp,['--version'],compiler);
      if(kind==='clang'?/clang version|Apple (?:LLVM|clang)/i.test(version):/g\+\+|gcc|Free Software Foundation/i.test(version)){compiler.cppPath=cpp;break;}
     }catch{}
    }
   }
   return {id:await realpath(file),name:kind==='gcc'?'GCC':kind==='clang'?'Clang':'Zig',version:output.trim().split(/\r?\n/)[0],target,compiler};
  }catch{return null;}
 }
 const results:DetectedCompiler[]=[];let next=0;
 await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
  while(next<candidates.length){const candidate=candidates[next++],result=await probe(candidate);if(result)results.push(result);}
 }));
 return results.sort((a,b)=>a.name.localeCompare(b.name)||a.compiler.cPath.localeCompare(b.compiler.cPath));
}
