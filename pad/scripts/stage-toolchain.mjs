import {readdir,stat,mkdir,copyFile,chmod,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const pad=path.resolve(fileURLToPath(new URL('..',import.meta.url))),work=path.resolve(pad,'../.work');
const nativeIncludes={
 'win-x64':new Set(['any-windows-any','x86_64-windows-any']),
 'linux-x64':new Set(['generic-glibc','generic-musl','any-linux-any','x86-linux-any','x86-linux-gnu','x86_64-linux-musl','x86-linux-musl']),
 'mac-arm64':new Set(['any-darwin-any','aarch64-macos-none'])
};
export function retainToolchainFile(target,name){
 if(!nativeIncludes[target])throw Error('Unsupported toolchain staging target: '+target);
 if(/(^|\/)(LICENSE[^/]*|COPYING[^/]*|COPYRIGHT[^/]*)$/i.test(name))return true;
 const parts=name.split('/');
 if(parts[0]==='lib'&&parts[1]==='libc'){
  const family=parts[2];
  if(family==='include')return nativeIncludes[target].has(parts[3]);
  if(['wasi','freebsd','netbsd','openbsd'].includes(family))return false;
  if(family==='mingw')return target==='win-x64';
  if(family==='glibc'||family==='musl')return target==='linux-x64';
  if(family==='darwin')return target==='mac-arm64';
 }
 return true;
}
export async function stageToolchain(target){
 const source=path.join(work,'toolchains',target),destination=path.join(work,'staged-toolchains',target);
 // Staging is an owned build output; the full development toolchain stays intact.
 if(path.dirname(destination)!==path.join(work,'staged-toolchains'))throw Error('Invalid staging destination');
 const entries=[];async function walk(dir,prefix=''){
  for(const item of await readdir(dir,{withFileTypes:true})){
   const name=prefix+item.name,file=path.join(dir,item.name);
   if(item.isSymbolicLink())throw Error('Unexpected toolchain symlink: '+name);
   if(item.isDirectory())await walk(file,name+'/');else if(item.isFile())entries.push({name,...await stat(file)});
  }
 }
 await walk(source);const retained=entries.filter(e=>retainToolchainFile(target,e.name)),removed=entries.filter(e=>!retainToolchainFile(target,e.name));
 await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});let next=0;
 await Promise.all(Array.from({length:16},async()=>{while(next<retained.length){
  const entry=retained[next++],out=path.join(destination,entry.name);await mkdir(path.dirname(out),{recursive:true});await copyFile(path.join(source,entry.name),out);await chmod(out,entry.mode);
 }}));
 const version=JSON.parse(await readFile(path.join(pad,'toolchains.json'),'utf8')).zigVersion;
 await writeFile(path.join(destination,'labpad-native.json'),JSON.stringify({schemaVersion:1,target,zigVersion:version,nativeOnly:true},null,2)+'\n');
 const report={target,version,before:{files:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0)},after:{files:retained.length+1,bytes:retained.reduce((n,e)=>n+e.size,0)+(await stat(path.join(destination,'labpad-native.json'))).size},removed:removed.map(e=>e.name),retained:retained.map(e=>e.name)};
 const reports=path.join(work,'toolchain-reports');await mkdir(reports,{recursive:true});await writeFile(path.join(reports,target+'.json'),JSON.stringify(report,null,2)+'\n');
 console.log('Toolchain '+target+': '+report.before.files+' -> '+report.after.files+' files');
 return destination;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 for(const target of process.argv.slice(2))await stageToolchain(target);
}
