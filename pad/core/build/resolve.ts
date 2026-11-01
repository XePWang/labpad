import {realpath,stat} from 'node:fs/promises';import path from 'node:path';import {glob} from 'tinyglobby';
import {relative,defaults,diagnostic,type Spec,type Plan,type Unit,type Language,type Command} from '../../shared/lpmake';
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
export async function resolve(spec:Spec,root:string,base=defaults,inherit=true):Promise<Plan>{
 const fail=(command:Command,value:string|undefined,reason:string,hint?:string,note?:string)=>diagnostic(spec,command,value,reason,hint,note);
 let canonical:string;try{canonical=await realpath(root);}catch{throw fail('target',undefined,'The project root is unavailable.','Restore the project directory, then build again.');}
 const inventory=await glob(['**/*'],{cwd:root,onlyFiles:true,followSymbolicLinks:false,dot:false});
 const keys=new Map<string,string>();for(const file of inventory){const key=file.normalize('NFC').toLowerCase(),first=keys.get(key);if(first)throw fail('add_files',undefined,'Project filenames conflict across platforms.','Rename one file so that names differ by more than case or Unicode normalization.','Conflicting paths: '+JSON.stringify(first)+' and '+JSON.stringify(file)+'.');keys.set(key,file);}
 if(!spec.sources.length)throw fail('target',undefined,'Missing add_files() declaration.','Add add_files("src/*.c") to select the source files.');
 const sourcePaths=spec.sources.map(value=>{try{return relative(value);}catch(error){throw fail('add_files',value,(error as Error).message,'Use source paths relative to the project root.');}});
 const excludePaths=spec.exclude.map(value=>{try{return relative(value);}catch(error){throw fail('remove_files',value,(error as Error).message,'Use exclusion patterns relative to the project root.');}});
 for(const pattern of spec.sources)if(!/[*?[\]{}()!]/.test(pattern)){const info=await stat(path.join(root,relative(pattern))).catch(()=>undefined);if(!info?.isFile())throw fail('add_files',pattern,'Source file '+JSON.stringify(pattern)+' does not exist.','Create the file or correct its path in add_files().','Literal source paths must name existing files, even when remove_files() excludes them.');}
 const names=(await glob(sourcePaths,{cwd:root,onlyFiles:true,expandDirectories:false,followSymbolicLinks:false,ignore:excludePaths})).map(p=>p.replaceAll('\\','/')).sort((a,b)=>{const x=a.normalize('NFC'),y=b.normalize('NFC');return x<y?-1:x>y?1:0;});
 if(!names.length)throw fail('add_files',undefined,'No source files remain in the build.','Add a C/C++ source file or correct add_files() and remove_files() patterns.','Source patterns are expanded from the project root, then exclusions are applied.');
 const dirs=[...new Set(spec.includeDirs.map(relative))];
 for(const [command,values] of [['add_includedirs',spec.includeDirs],['add_linkdirs',spec.linkDirs]] as [Command,string[]][]){
  for(const original of values){const directory=relative(original);
   let full:string;try{full=await realpath(path.join(root,directory));if(!(await stat(full)).isDirectory())throw new Error();}catch{throw fail(command,original,'Directory '+JSON.stringify(directory)+' does not exist or is not a directory.','Create the directory or correct its path in '+command+'().','Directory paths are relative to the project root.');}
   if(!inside(canonical,full))throw fail(command,original,'Directory '+JSON.stringify(directory)+' resolves outside the project.','Use a directory inside the project; remove external symlinks.');
  }
 }
 const units:Unit[]=[];
 for(const name of [...new Set(names)]){
  let full:string;try{full=await realpath(path.join(root,name));}catch{throw fail('add_files',undefined,'Source file '+JSON.stringify(name)+' is unavailable.','Restore the file or update the source patterns, then build again.');}
  if(!inside(canonical,full))throw fail('add_files',undefined,'Source file '+JSON.stringify(name)+' resolves outside the project.','Move the source into the project and remove external symlinks.');
  const ext=path.extname(name).toLowerCase();if(!['.c','.cpp','.cc','.cxx'].includes(ext))throw fail('add_files',undefined,'Unsupported source extension in '+JSON.stringify(name)+'.','Use .c, .cpp, .cc or .cxx files. Exclude headers and data files from add_files().');
  const inferred:Language=ext==='.c'?'c':'cpp',language=spec.language??inferred,args=[...(inherit?base[language]:[])];
  if(spec.standards[language])args.push('-std='+spec.standards[language]);
  args.push(...(spec.mode==='debug'?['-g','-O0','-UNDEBUG']:['-O2','-DNDEBUG']));
  if(spec.optimize)args.push('-'+spec.optimize);
  args.push(...dirs.map(d=>'-I'+path.join(root,d)),...spec.defines.map(d=>'-D'+d),...(language==='c'?spec.cflags:spec.cxxflags));
  args.push('-x',language==='c'?'c':'c++');units.push({path:name,language,args});
 }
 return {version:1,target:spec.target,units,linkLanguage:units.some(u=>u.language==='cpp')?'cpp':'c',linkArgs:[...(inherit?base.link:[]),...spec.linkDirs.map(d=>'-L'+path.join(root,relative(d))),...spec.links.map(l=>'-l'+l),...spec.ldflags],mode:spec.mode};
}
