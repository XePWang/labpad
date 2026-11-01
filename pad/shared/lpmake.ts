import type {SyntaxNode} from '@lezer/common';
import {parser} from './lpmake-parser';
export {parser};
export type Language='c'|'cpp';
export const commands=['target','set_language','set_standard','set_mode','set_optimize','add_files','remove_files','add_includedirs','add_defines','add_linkdirs','add_links','add_cflags','add_cxxflags','add_ldflags'] as const;
export type Command=typeof commands[number];
export interface Arg {value:string;from:number;to:number}
export interface Call {name:Command;from:number;to:number;args:Arg[]}
export interface Spec {version:1;target:string;language?:Language;standards:Partial<Record<Language,string>>;mode:'debug'|'release';optimize?:string;sources:string[];exclude:string[];includeDirs:string[];defines:string[];linkDirs:string[];links:string[];cflags:string[];cxxflags:string[];ldflags:string[]}
export interface Unit {path:string;language:Language;args:string[]}
export interface Plan {version:1;target:string;units:Unit[];linkLanguage:Language;linkArgs:string[];mode:Spec['mode']}
export interface Defaults {c:string[];cpp:string[];link:string[]}
export const defaults:Defaults={c:['-std=c17','-O2','-Wall','-Wextra'],cpp:['-std=c++17','-O2','-Wall','-Wextra'],link:['-lm']};
export class ConfigError extends Error {line:number;column:number;constructor(text:string,pos:number,message:string){const before=text.slice(0,pos).split('\n');super('LPMake.txt '+before.length+':'+(before.at(-1)!.length+1)+' '+message);this.line=before.length;this.column=before.at(-1)!.length+1;}}
const family=(v:string):Language|undefined=>/^(?:c|gnu)(?:89|90|99|11|17|23)$/.test(v)?'c':/^(?:c|gnu)\+\+(?:11|14|17|20|23)$/.test(v)?'cpp':undefined;
export const relative=(value:string)=>{const v=value.replaceAll('\\','/').replace(/^\.\//,'');if(!v||v.startsWith('/')||/^[a-z]:/i.test(v)||v.split('/').some(p=>p==='..')||/[\0\r\n]/.test(v))throw Error('路径必须位于项目内：'+value);return v;};
export function parse(text:string):{spec:Spec;calls:Call[]}{
 const tree=parser.parse(text),cursor=tree.cursor();do{if(cursor.type.isError)throw new ConfigError(text,cursor.from,'语法无效，请检查命令、引号、逗号及括号');}while(cursor.next());
 const calls:Call[]=tree.topNode.getChildren('Call').map((node:SyntaxNode)=>{
  const nameNode=node.getChild('Name')!,name=text.slice(nameNode.from,nameNode.to);
  if(!commands.includes(name as Command))throw new ConfigError(text,nameNode.from,'未知命令 '+name);
  const args=(node.getChild('Arguments')?.getChildren('String')??[]).map(arg=>{let value:string;try{value=JSON.parse(text.slice(arg.from,arg.to));}catch{throw new ConfigError(text,arg.from,'字符串转义无效');}if(value.includes('\0'))throw new ConfigError(text,arg.from,'参数不能含有NUL');return {value,from:arg.from,to:arg.to};});
  if(!args.length||(['target','set_language','set_standard','set_mode','set_optimize'].includes(name)&&args.length!==1))throw new ConfigError(text,node.from,name+'参数数目无效');
  return {name:name as Command,from:node.from,to:node.to,args};
 });
 const spec:Spec={version:1,target:'',standards:{},mode:'debug',sources:[],exclude:[],includeDirs:[],defines:[],linkDirs:[],links:[],cflags:[],cxxflags:[],ldflags:[]};
 const seen=new Set<string>();
 const lists:Partial<Record<Command,keyof Spec>>={add_files:'sources',remove_files:'exclude',add_includedirs:'includeDirs',add_defines:'defines',add_linkdirs:'linkDirs',add_links:'links',add_cflags:'cflags',add_cxxflags:'cxxflags',add_ldflags:'ldflags'};
 for(const call of calls){const first=call.args[0],v=first.value;
  if(call.name.startsWith('set_')||call.name==='target'){
   const slot=call.name==='set_standard'?'standard:'+family(v):call.name;
   if(seen.has(slot))throw new ConfigError(text,call.from,'重复声明 '+slot);seen.add(slot);
   if(call.name==='target'){if(!/^[\p{L}\p{N}_-]+$/u.test(v))throw new ConfigError(text,first.from,'目标名不能包含路径或空白');spec.target=v;}
   if(call.name==='set_language'){if(!['c','c++'].includes(v))throw new ConfigError(text,first.from,'语言应为c或c++');spec.language=v==='c'?'c':'cpp';}
   if(call.name==='set_standard'){const f=family(v);if(!f)throw new ConfigError(text,first.from,'不支持的标准 '+v);spec.standards[f]=v;}
   if(call.name==='set_mode'){if(!['debug','release'].includes(v))throw new ConfigError(text,first.from,'模式应为debug或release');spec.mode=v as Spec['mode'];}
   if(call.name==='set_optimize'){if(!['O0','O1','O2','O3','Os'].includes(v))throw new ConfigError(text,first.from,'优化级别应为O0/O1/O2/O3/Os');spec.optimize=v;}
  }else{const list=spec[lists[call.name]!] as string[];
   for(const a of call.args){
    if(call.name==='add_defines'&&!/^[A-Za-z_][A-Za-z_0-9]*(?:=[\s\S]*)?$/.test(a.value))throw new ConfigError(text,a.from,'宏名无效：'+a.value);
    if(['add_files','remove_files','add_includedirs','add_linkdirs'].includes(call.name)){try{relative(a.value);}catch(e){throw new ConfigError(text,a.from,(e as Error).message);}}
    list.push(a.value);
   }
  }
 }
 if(!spec.target)throw new ConfigError(text,0,'缺少target声明');
 return {spec,calls};
}
export function editSingle(text:string,name:Command,value:string|undefined,standardFamily?:Language):string{
 if(name==='target'&&value===undefined)throw new Error('target不能为空');
 const {calls}=parse(text);const call=calls.find(c=>c.name===name&&(name!=='set_standard'||family(c.args[0].value)===standardFamily));
 let result:string;
 if(call&&value!==undefined){const arg=call.args[0];result=text.slice(0,arg.from)+JSON.stringify(value)+text.slice(arg.to);}
 else if(call){
  const comments=parser.parse(text).topNode.getChildren('Comment');
  const preserve:string[]=[];const cur=parser.parse(text).cursor();do{if(cur.name==='Comment'&&cur.from>=call.from&&cur.to<=call.to)preserve.push(text.slice(cur.from,cur.to));}while(cur.next());
  result=text.slice(0,call.from)+(preserve.length?preserve.join('\n')+'\n':'')+text.slice(call.to);
 }else if(value!==undefined){
  const target=calls.find(c=>c.name==='target')!,lineEnd=text.indexOf('\n',target.to),at=lineEnd<0?text.length:lineEnd+1;
  result=text.slice(0,at)+(at===text.length&&!text.endsWith('\n')?'\n':'')+name+'('+JSON.stringify(value)+')\n'+text.slice(at);
 }else return text;
 parse(result);return result;
}
export function editArgument(text:string,name:Command,callIndex:number,argIndex:number,value:string):string{
 const call=parse(text).calls.filter(c=>c.name===name)[callIndex];if(!call)throw Error('调用不存在');const a=call.args[argIndex];if(!a)throw Error('参数不存在');
 const result=text.slice(0,a.from)+JSON.stringify(value)+text.slice(a.to);parse(result);return result;
}

export function editList(text:string,name:Command,values:string[]){
 const {calls}=parse(text),matching=calls.filter(c=>c.name===name),changes:{from:number;to:number;insert:string}[]=[];let index=0;
 function keepComments(from:number,to:number){const all:string[]=[],cur=parser.parse(text).cursor();do{if(cur.name==='Comment'&&cur.from>=from&&cur.to<=to)all.push(text.slice(cur.from,cur.to));}while(cur.next());return all.length?all.join('\n')+'\n':'';}
 for(const call of matching){
  const count=Math.min(call.args.length,Math.max(0,values.length-index));
  if(!count){changes.push({from:call.from,to:call.to,insert:keepComments(call.from,call.to)});continue;}
  for(let i=0;i<count;i++)changes.push({from:call.args[i].from,to:call.args[i].to,insert:JSON.stringify(values[index++])});
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
