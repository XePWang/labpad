import {defaultCompilerConfig} from './defaults';
import stringWidth from 'string-width';
import type {SyntaxNode} from '@lezer/common';
import {parser} from './lpmake-parser';
export {parser};
export type Language='c'|'cpp';
export const canonicalCommands=['target','set_language','set_standard','set_mode','set_optimize','add_files','remove_files','add_includedirs','add_defines','add_linkdirs','add_links','add_cflags','add_cxxflags','add_ldflags'] as const;
export const commands=[...canonicalCommands,'set_languages','add_cxflags','set_kind','del_files'] as const;
export type Command=typeof commands[number];
export interface Arg {value:string;from:number;to:number}
export interface Call {name:Command;from:number;to:number;args:Arg[]}
export interface Spec {version:1;target:string;language?:Language;standards:Partial<Record<Language,string>>;mode:'debug'|'release';optimize?:string;sources:string[];exclude:string[];includeDirs:string[];defines:string[];linkDirs:string[];links:string[];cflags:string[];cxxflags:string[];ldflags:string[];origin?:{text:string;calls:Call[]}}
export interface Unit {path:string;language:Language;args:string[]}
export interface Plan {version:1;target:string;units:Unit[];linkLanguage:Language;linkArgs:string[];mode:Spec['mode']}
export interface Defaults {c:string[];cpp:string[];link:string[]}
const compilerDefaults=defaultCompilerConfig('gcc');
export const defaults:Defaults={c:compilerDefaults.cArgs,cpp:compilerDefaults.cppArgs,link:compilerDefaults.linkArgs};
export class ConfigError extends Error {
 line:number;column:number;
 constructor(text:string,pos:number,reason:string,hint?:string,note?:string,to=pos+1){
  pos=Math.max(0,Math.min(pos,text.length));const before=text.slice(0,pos),line=before.split('\n').length,start=before.lastIndexOf('\n')+1,end=text.indexOf('\n',pos);
  const raw=text.slice(start,end<0?text.length:end).replace(/\r$/,''),prefix=text.slice(start,pos),display=raw.replace(/\t/g,'    '),width=stringWidth(prefix.replace(/\t/g,'    ')),span=Math.max(1,Math.min(64,stringWidth(text.slice(pos,Math.min(to,start+raw.length)).replace(/\t/g,'    '))));
  const gutter=String(line),column=prefix.length+1;
  super('LPMake.txt:'+line+':'+column+': error: '+reason+'\n  '+gutter+' | '+display+'\n  '+' '.repeat(gutter.length)+' | '+' '.repeat(width)+'^'+'~'.repeat(span-1)+(hint?'\n  hint: '+hint:'')+(note?'\n  note: '+note:''));
  this.line=line;this.column=column;
 }
}
export function diagnostic(spec:Spec,command:Command,value:string|undefined,reason:string,hint?:string,note?:string):ConfigError{
 const source=spec.origin,call=source?.calls.find(c=>(c.name===command||command==='remove_files'&&c.name==='del_files'||(command==='add_cflags'||command==='add_cxxflags')&&c.name==='add_cxflags'||command==='set_standard'&&c.name==='set_languages')&&(value===undefined||c.args.some(a=>a.value===value||command==='set_standard'&&canonicalStandard(a.value)===value))),arg=value===undefined?undefined:call?.args.find(a=>a.value===value||command==='set_standard'&&canonicalStandard(a.value)===value);
 return new ConfigError(source?.text??'',arg?.from??call?.from??0,reason,hint,note??(!source?'Source locations were not included in this build configuration.':undefined),arg?.to??call?.to);
}
export const canonicalStandard=(v:string)=>v.replace(/^cxx/,'c++').replace(/^gnuxx/,'gnu++').replace(/(?:\+\+)1z$/,'++17').replace(/(?:\+\+)2a$/,'++20').replace(/(?:\+\+)2b$/,'++23');
const family=(value:string):Language|undefined=>{const v=canonicalStandard(value);return /^(?:c|gnu)(?:89|90|99|11|17|23)$/.test(v)?'c':/^(?:c|gnu)\+\+(?:98|03|11|14|17|20|23)$/.test(v)?'cpp':undefined;};
const optimizeAliases:Record<string,string>={none:'O0',fast:'O1',faster:'O2',fastest:'O3',smallest:'Os'};
const canonicalValue=(name:Command,value:string)=>name==='set_standard'||name==='set_languages'?canonicalStandard(value):name==='set_optimize'?optimizeAliases[value]??value:value;
export const relative=(value:string)=>{const raw=value.replaceAll('\\','/').replace(/^\$\(projectdir\)(?:\/|$)/,'./'),v=raw.split('/').filter(p=>p&&p!=='.').join('/')||'.';if(!raw||raw.startsWith('/')||/^[a-z]:/i.test(raw)||v.split('/').some(p=>p==='..')||/[\0\r\n]/.test(v))throw Error('Invalid project-relative path '+JSON.stringify(value)+'. Absolute paths, parent traversal and line breaks are not allowed.');return v;};
export function decodeLiteral(raw:string){
 if(raw.startsWith('"'))return JSON.parse(raw) as string;
 const body=raw.slice(1,-1).replace(/\\'|\\.|"/g,token=>token==="\\'"?"'":token==='"'?'\\"':token);
 return JSON.parse('"'+body+'"') as string;
}
const replacements:Record<string,string>={set_warnings:'Use add_cflags(...) and add_cxxflags(...) to declare explicit warning flags.',set_symbols:'Use set_mode("debug") or add_cflags("-g") / add_cxxflags("-g").'};
export function parse(text:string):{spec:Spec;calls:Call[]}{
 const tree=parser.parse(text),cursor=tree.cursor();do{if(cursor.type.isError)throw new ConfigError(text,cursor.from,cursor.from>=text.length?'Unexpected end of file.':'Unexpected token '+JSON.stringify(text.slice(cursor.from,Math.max(cursor.from+1,cursor.to)))+'.','Use command("value", "value") syntax. Check quotes, commas and parentheses.',undefined,cursor.to);}while(cursor.next());
 const calls:Call[]=tree.topNode.getChildren('Call').map((node:SyntaxNode)=>{
  const nameNode=node.getChild('Name')!,name=text.slice(nameNode.from,nameNode.to);
  if(!commands.includes(name as Command))throw new ConfigError(text,nameNode.from,'Unknown command '+JSON.stringify(name)+'.',replacements[name]??'Use a supported LPMake command; for source files, use add_files("./*.c").','Command names are case-sensitive. Supported commands: '+commands.join(', ')+'.',nameNode.to);
  const args=(node.getChild('Arguments')?.getChildren('String')??[]).map(arg=>{let value:string;try{value=decodeLiteral(text.slice(arg.from,arg.to));}catch{throw new ConfigError(text,arg.from,'Invalid escape sequence in a string literal.','Use supported string escapes: \\n, \\t, escaped quotes, or double backslashes for a literal backslash.',undefined,arg.to);}if(value.includes('\0'))throw new ConfigError(text,arg.from,'A string argument contains a NUL character.','Remove the NUL escape or character from this argument.',undefined,arg.to);return {value,from:arg.from,to:arg.to};});
  if(!args.length||(['target','set_language','set_standard','set_mode','set_optimize','set_kind'].includes(name)&&args.length!==1))throw new ConfigError(text,node.from,name+'() expects '+(['target','set_language','set_standard','set_mode','set_optimize','set_kind'].includes(name)?'exactly one string argument':'at least one string argument')+'; received '+args.length+'.','Pass quoted strings separated by commas.',undefined,node.to);
  return {name:name as Command,from:node.from,to:node.to,args};
 });
 const spec:Spec={version:1,target:'',standards:{},mode:'debug',sources:[],exclude:[],includeDirs:[],defines:[],linkDirs:[],links:[],cflags:[],cxxflags:[],ldflags:[]};
 const seen=new Map<string,Call>();
 const lists:Partial<Record<Command,keyof Spec>>={add_files:'sources',remove_files:'exclude',del_files:'exclude',add_includedirs:'includeDirs',add_defines:'defines',add_linkdirs:'linkDirs',add_links:'links',add_cflags:'cflags',add_cxxflags:'cxxflags',add_ldflags:'ldflags'};
 function standard(call:Call,arg:Arg){
  const value=canonicalStandard(arg.value),slot=family(value);
  if(!slot)throw new ConfigError(text,arg.from,'Unsupported language standard '+JSON.stringify(arg.value)+'.','Use an explicit standard such as c17, c++20 or cxx20.',undefined,arg.to);
  const key='standard:'+slot,previous=seen.get(key);if(previous)throw new ConfigError(text,arg.from,'Duplicate language standard for '+(slot==='c'?'C':'C++')+'.','Keep one standard for each language.','The previous declaration is on line '+(text.slice(0,previous.from).split('\n').length)+'.',arg.to);
  seen.set(key,call);spec.standards[slot]=value;
 }
 for(const call of calls){const first=call.args[0],v=canonicalValue(call.name,first.value);
  if(call.name==='set_languages'||call.name==='set_standard'){for(const arg of call.args)standard(call,arg);continue;}
  if(call.name==='add_cxflags'){for(const arg of call.args){spec.cflags.push(arg.value);spec.cxxflags.push(arg.value);}continue;}
  if(call.name==='set_kind'){if(v!=='binary')throw new ConfigError(text,first.from,'Unsupported target kind '+JSON.stringify(v)+'.','LPMake builds one executable; use set_kind("binary") or omit this declaration.',undefined,first.to);if(seen.has('set_kind'))throw new ConfigError(text,call.from,'Duplicate set_kind() declaration.','Keep one set_kind("binary") declaration.',undefined,call.to);seen.set('set_kind',call);continue;}

  if(call.name.startsWith('set_')||call.name==='target'){
   const slot=call.name;
   if(seen.has(slot)){const original=seen.get(slot)!,line=text.slice(0,original.from).split('\n').length;throw new ConfigError(text,call.from,'Duplicate '+call.name+'() declaration'+'.','Keep one declaration for this setting.','The previous declaration is on line '+line+'.',call.to);}seen.set(slot,call);
   if(call.name==='target'){if(!/^[\p{L}\p{N}_-]+$/u.test(v))throw new ConfigError(text,first.from,'Invalid target name '+JSON.stringify(v)+'.','Use letters, digits, underscores or hyphens; remove whitespace and path separators.',undefined,first.to);spec.target=v;}
   if(call.name==='set_language'){if(!['c','c++'].includes(v))throw new ConfigError(text,first.from,'Unsupported language '+JSON.stringify(v)+'.','Use set_language("c") or set_language("c++").','Omit set_language() to infer the language from each source extension.',first.to);spec.language=v==='c'?'c':'cpp';}
   if(call.name==='set_mode'){if(!['debug','release'].includes(v))throw new ConfigError(text,first.from,'Unsupported build mode '+JSON.stringify(v)+'.','Use set_mode("debug") or set_mode("release").',undefined,first.to);spec.mode=v as Spec['mode'];}
   if(call.name==='set_optimize'){if(!['O0','O1','O2','O3','Os'].includes(v))throw new ConfigError(text,first.from,'Unsupported optimization level '+JSON.stringify(v)+'.','Use "O0", "O1", "O2", "O3" or "Os". Use set_mode("debug") for debug mode.',undefined,first.to);spec.optimize=v;}
  }else{const list=spec[lists[call.name]!] as string[];
   for(const a of call.args){
    if(call.name==='add_defines'&&!/^[A-Za-z_][A-Za-z_0-9]*(?:=[\s\S]*)?$/.test(a.value))throw new ConfigError(text,a.from,'Invalid macro definition '+JSON.stringify(a.value)+'.','Use NAME or NAME=value, for example add_defines("MAX_BUF=4096").','Macro names must match [A-Za-z_][A-Za-z_0-9]* and cannot contain whitespace.',a.to);
    if(['add_files','remove_files','del_files','add_includedirs','add_linkdirs'].includes(call.name)){try{relative(a.value);}catch(e){throw new ConfigError(text,a.from,(e as Error).message,'Use a path relative to the project root, for example "src/main.c" or "include".',undefined,a.to);}}
    list.push(a.value);
   }
  }
 }
 if(!spec.target)throw new ConfigError(text,0,'Missing target() declaration.','Add target("app") to define the executable target.');
 spec.origin={text,calls};return {spec,calls};
}
export function editSingle(text:string,name:Command,value:string|undefined,standardFamily?:Language):string{
 if(name==='target'&&value===undefined)throw new ConfigError(text,0,'The executable target cannot be removed.','Keep one target("name") declaration.');
 const parsed=parse(text),{calls}=parsed;
 if(name==='set_standard'&&calls.some(c=>c.name==='set_languages')){
  if(standardFamily&&parsed.spec.standards[standardFamily]===(value===undefined?undefined:canonicalStandard(value)))return text;
  return editSingle(canonicalText(text,['set_languages']),name,value,standardFamily);
 }
 const call=calls.find(c=>c.name===name&&(name!=='set_standard'||family(c.args[0].value)===standardFamily));
 let result:string;
 if(call&&value!==undefined){const arg=call.args[0];if(canonicalValue(name,arg.value)===canonicalValue(name,value))return text;result=text.slice(0,arg.from)+JSON.stringify(value)+text.slice(arg.to);}
 else if(call){
  const comments=parser.parse(text).topNode.getChildren('Comment');
  const preserve:string[]=[];const cur=parser.parse(text).cursor();do{if(/Comment$/.test(cur.name)&&cur.from>=call.from&&cur.to<=call.to)preserve.push(text.slice(cur.from,cur.to));}while(cur.next());
  result=text.slice(0,call.from)+(preserve.length?preserve.join('\n')+'\n':'')+text.slice(call.to);
 }else if(value!==undefined){
  const target=calls.find(c=>c.name==='target')!,lineEnd=text.indexOf('\n',target.to),at=lineEnd<0?text.length:lineEnd+1;
  result=text.slice(0,at)+(at===text.length&&!text.endsWith('\n')?'\n':'')+name+'('+JSON.stringify(value)+')\n'+text.slice(at);
 }else return text;
 parse(result);return result;
}
export function editArgument(text:string,name:Command,callIndex:number,argIndex:number,value:string):string{
 const call=parse(text).calls.filter(c=>c.name===name)[callIndex];if(!call)throw new ConfigError(text,0,'Cannot edit '+name+'(): declaration '+(callIndex+1)+' was not found.','Reload the build settings and try again.');const a=call.args[argIndex];if(!a)throw new ConfigError(text,call.from,'Cannot edit '+name+'(): argument '+(argIndex+1)+' was not found.','Reload the build settings and try again.');
 if(a.value===value)return text;
 const result=text.slice(0,a.from)+JSON.stringify(value)+text.slice(a.to);parse(result);return result;
}

export function canonicalText(text:string,names:Command[]):string{
 const {calls}=parse(text),changes:{from:number;to:number;insert:string}[]=[];
 for(const call of calls.filter(c=>names.includes(c.name))){
  let lines:string[]|undefined;
  if(call.name==='set_languages')lines=call.args.map(a=>'set_standard('+JSON.stringify(canonicalStandard(a.value))+')');
  if(call.name==='add_cxflags')lines=['add_cflags','add_cxxflags'].map(name=>name+'('+call.args.map(a=>JSON.stringify(a.value)).join(', ')+')');
  if(call.name==='del_files')lines=['remove_files('+call.args.map(a=>JSON.stringify(a.value)).join(', ')+')'];
  if(!lines)continue;
  const comments:string[]=[],cursor=parser.parse(text).cursor();do{if(/Comment$/.test(cursor.name)&&cursor.from>=call.from&&cursor.to<=call.to)comments.push(text.slice(cursor.from,cursor.to));}while(cursor.next());
  changes.push({from:call.from,to:call.to,insert:[...comments,...lines].join('\n')});
 }
 let result=text;for(const change of changes.sort((a,b)=>b.from-a.from))result=result.slice(0,change.from)+change.insert+result.slice(change.to);
 parse(result);return result;
}

export function editList(text:string,name:Command,values:string[]){
 const parsed=parse(text),alias=name==='add_cflags'||name==='add_cxxflags'?'add_cxflags':name==='remove_files'?'del_files':undefined;
 if(alias&&parsed.calls.some(c=>c.name===alias)){
  const current=name==='add_cflags'?parsed.spec.cflags:name==='add_cxxflags'?parsed.spec.cxxflags:parsed.spec.exclude;
  if(JSON.stringify(current)===JSON.stringify(values))return text;
  return editList(canonicalText(text,[alias]),name,values);
 }
 const {calls}=parse(text),matching=calls.filter(c=>c.name===name),changes:{from:number;to:number;insert:string}[]=[];let index=0;
 function keepComments(from:number,to:number){const all:string[]=[],cur=parser.parse(text).cursor();do{if(/Comment$/.test(cur.name)&&cur.from>=from&&cur.to<=to)all.push(text.slice(cur.from,cur.to));}while(cur.next());return all.length?all.join('\n')+'\n':'';}
 for(const call of matching){
  const count=Math.min(call.args.length,Math.max(0,values.length-index));
  if(!count){changes.push({from:call.from,to:call.to,insert:keepComments(call.from,call.to)});continue;}
  for(let i=0;i<count;i++){const value=values[index++];if(call.args[i].value!==value)changes.push({from:call.args[i].from,to:call.args[i].to,insert:JSON.stringify(value)});}
  if(count<call.args.length){
   const argsNode=parser.parse(text).topNode.getChildren('Call').find(n=>n.from===call.from)!.getChild('Arguments')!;
   // Remove tail literals and separators only; comment tokens remain in their original positions.
   for(let c=argsNode.firstChild;c;c=c.nextSibling)if(c.from>=call.args[count-1].to&&(c.name==='String'||c.name==='Comma'))changes.push({from:c.from,to:c.to,insert:''});
  }
 }
 if(index<values.length){
  const call=matching.at(-1);
  if(call){
   const last=call.args.at(-1)!,after=text.slice(last.to,call.to),hasComma=/^\s*,/.test(after);
   changes.push({from:last.to,to:last.to,insert:', '+values.slice(index).map(v=>JSON.stringify(v)).join(', ')});
  }else{
   const target=calls.find(c=>c.name==='target')!,end=text.indexOf('\n',target.to),at=end<0?text.length:end+1;
   changes.push({from:at,to:at,insert:(at===text.length&&!text.endsWith('\n')?'\n':'')+name+'('+values.map(v=>JSON.stringify(v)).join(', ')+')\n'});
  }
 }
 let result=text;for(const c of changes.sort((a,b)=>b.from-a.from||b.to-a.to))result=result.slice(0,c.from)+c.insert+result.slice(c.to);
 parse(result);return result;
}
