import picomatch from 'picomatch';
import {relative,diagnostic,type Spec} from '../../shared/lpmake';
/** Normalize Xmake's recursive extension shorthand before using the shared matcher. */
export function fileGlob(value:string){return relative(value).split('/').map(part=>part.startsWith('**')&&part!=='**'&&!part.slice(2).includes('**')?'**/*'+part.slice(2):part).join('/');}
interface Rule{include:(file:string)=>boolean;exclude:((file:string)=>boolean)[];literal?:string}
function rule(spec:Spec,value:string,command:'add_files'|'remove_files'):Rule{
 const [head,...filters]=value.split('|');
 if(!head||filters.some(f=>!f))throw diagnostic(spec,command,value,'Empty file pattern or exclusion filter.','Use add_files("src/**.c|test.c") or separate remove_files() declarations.');
 const original=relative(head),wildcard=original.search(/[*?[\]{}()!]/),last=original.lastIndexOf('/',wildcard<0?original.length:wildcard),base=last<0?'':original.slice(0,last+1);
 try{return {include:picomatch(fileGlob(head),{dot:false}),exclude:filters.map(f=>picomatch(fileGlob(base+relative(f)),{dot:false})),...(!/[*?[\]{}()!]/.test(original)?{literal:original}:{})};}
 catch(error){throw diagnostic(spec,command,value,'Invalid file pattern.','Check the pattern and use project-relative paths.',error instanceof Error?error.message:String(error));}
}
const matches=(rule:Rule,file:string)=>rule.include(file)&&!rule.exclude.some(exclude=>exclude(file));
export function sourceNames(spec:Spec,files:string[]){
 if(!spec.sources.length)throw diagnostic(spec,'target',undefined,'Missing add_files() declaration.','Add add_files("./*.c") to select source files.');
 const include=spec.sources.map(value=>rule(spec,value,'add_files')),exclude=spec.exclude.map(value=>rule(spec,value,'remove_files'));
 for(const [i,item]of include.entries())if(item.literal&&!files.includes(item.literal))throw diagnostic(spec,'add_files',spec.sources[i],'Source file '+JSON.stringify(item.literal)+' does not exist.','Create the file or correct its path in add_files().','Literal source paths must name existing files, even when excluded.');
 const names=[...new Set(files.filter(file=>include.some(r=>matches(r,file))&&!exclude.some(r=>matches(r,file))))].sort((a,b)=>a.normalize('NFC')<b.normalize('NFC')?-1:a.normalize('NFC')>b.normalize('NFC')?1:0);
 if(!names.length)throw diagnostic(spec,'add_files',undefined,'No source files remain in the build.','Add source files or correct add_files() and remove_files().');
 return names;
}
