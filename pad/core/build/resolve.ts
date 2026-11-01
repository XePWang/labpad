import {sourceNames,projectPlan} from './plan';
import {realpath,stat} from 'node:fs/promises';import path from 'node:path';import {glob} from 'tinyglobby';
import {relative,defaults,diagnostic,type Spec,type Plan,type Unit,type Language,type Command} from '../../shared/lpmake';
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
export async function resolve(spec:Spec,root:string,base=defaults,inherit=false,linkTarget?:string):Promise<Plan>{
 const fail=(command:Command,value:string|undefined,reason:string,hint?:string,note?:string)=>diagnostic(spec,command,value,reason,hint,note);
 let canonical:string;try{canonical=await realpath(root);}catch{throw fail('target',undefined,'The project root is unavailable.','Restore the project directory, then build again.');}
 const inventory=await glob(['**/*'],{cwd:root,onlyFiles:true,followSymbolicLinks:false,dot:false});
 const keys=new Map<string,string>();for(const file of inventory){const key=file.normalize('NFC').toLowerCase(),first=keys.get(key);if(first)throw fail('add_files',undefined,'Project filenames conflict across platforms.','Rename one file so that names differ by more than case or Unicode normalization.','Conflicting paths: '+JSON.stringify(first)+' and '+JSON.stringify(file)+'.');keys.set(key,file);}
 const names=sourceNames(spec,inventory);
 for(const [command,values] of [['add_includedirs',spec.includeDirs],['add_linkdirs',spec.linkDirs]] as [Command,string[]][]){
  for(const original of values){const directory=relative(original);
   let full:string;try{full=await realpath(path.join(root,directory));if(!(await stat(full)).isDirectory())throw new Error();}catch{throw fail(command,original,'Directory '+JSON.stringify(directory)+' does not exist or is not a directory.','Create the directory or correct its path in '+command+'().','Directory paths are relative to the project root.');}
   if(!inside(canonical,full))throw fail(command,original,'Directory '+JSON.stringify(directory)+' resolves outside the project.','Use a directory inside the project; remove external symlinks.');
  }
 }
 for(const name of names){
  let full:string;try{full=await realpath(path.join(root,name));}catch{throw fail('add_files',undefined,'Source file '+JSON.stringify(name)+' is unavailable.','Restore the file or update the source patterns.');}
  if(!inside(canonical,full))throw fail('add_files',undefined,'Source file '+JSON.stringify(name)+' resolves outside the project.','Move the source into the project and remove external symlinks.');
 }
 return projectPlan(spec,names,base,inherit,root,linkTarget);
}
