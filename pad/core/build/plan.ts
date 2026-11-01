import path from 'node:path';
import picomatch from 'picomatch';
import {parse,relative,diagnostic,type Spec,type Defaults,type Plan,type Language} from '../../shared/lpmake';
import {withDefaultStandard} from '../../shared/defaults';
import {parameterErrors,argumentSummary,parameterAdvice,relativePathAdvice,type ParameterIssue} from '../../shared/parameters';
import type {CompilerConfig,Draft} from '../../shared/types';
export function sourceNames(spec:Spec,files:string[]){
 if(!spec.sources.length)throw diagnostic(spec,'target',undefined,'Missing add_files() declaration.','Add add_files("src/*.c") to select source files.');
 const patterns=spec.sources.map(relative),exclude=spec.exclude.map(relative);
 for(const original of spec.sources)if(!/[*?[\]{}()!]/.test(original)&&!files.includes(relative(original)))throw diagnostic(spec,'add_files',original,'Source file '+JSON.stringify(original)+' does not exist.','Create the file or correct its path in add_files().','Literal source paths must name existing files, even when excluded.');
 const include=picomatch(patterns,{dot:false}),remove=exclude.length?picomatch(exclude,{dot:false}):()=>false;
 const names=[...new Set(files.filter(f=>include(f)&&!remove(f)))].sort((a,b)=>a.normalize('NFC')<b.normalize('NFC')?-1:a.normalize('NFC')>b.normalize('NFC')?1:0);
 if(!names.length)throw diagnostic(spec,'add_files',undefined,'No source files remain in the build.','Add source files or correct add_files() and remove_files().');
 return names;
}
function check(spec:Spec,args:string[],field:string,command?:'add_cflags'|'add_cxxflags'|'add_ldflags'){
 const issue=parameterErrors(args,field)[0];if(!issue)return;
 if(command)throw diagnostic(spec,command,args[issue.index!],issue.reason!,issue.hint);
 throw diagnostic(spec,'target',undefined,issue.reason!,issue.hint,'The conflicting argument comes from machine defaults: '+JSON.stringify(args[issue.index!])+'.');
}
export interface ParameterLayer{label:string;args:string[]}
function compileLayers(spec:Spec,language:Language,base:Defaults,inherit:boolean,root:string):ParameterLayer[]{
 const inherited=inherit?base[language]:[],fallback=spec.standards[language]?[]:withDefaultStandard(inherited,language).slice(0,withDefaultStandard(inherited,language).length-inherited.length);
 return [
  {label:'语言标准兜底',args:fallback},
  {label:'本机默认参数',args:[...inherited]},
  {label:'LPMake 语言标准',args:spec.standards[language]?['-std='+spec.standards[language]]:[]},
  {label:'构建模式 · '+spec.mode,args:spec.mode==='debug'?['-g','-O0','-UNDEBUG']:['-O2','-DNDEBUG']},
  {label:'显式优化',args:spec.optimize?['-'+spec.optimize]:[]},
  {label:'包含目录与宏',args:[...[...new Set(spec.includeDirs.map(relative))].map(d=>'-I'+path.join(root,d)),...spec.defines.map(d=>'-D'+d)]},
  {label:'额外 '+(language==='c'?'C':'C++')+' 编译参数',args:[...(language==='c'?spec.cflags:spec.cxxflags)]},
  {label:'LabPad 编译语言',args:['-x',language==='c'?'c':'c++']}
 ].filter(g=>g.args.length);
}
function linkLayers(spec:Spec,base:Defaults,inherit:boolean,root:string):ParameterLayer[]{return [
 {label:'本机默认链接参数',args:inherit?[...base.link]:[]},
 {label:'库目录与链接库',args:[...spec.linkDirs.map(d=>'-L'+path.join(root,relative(d))),...spec.links.map(l=>'-l'+l)]},
 {label:'额外链接参数',args:[...spec.ldflags]}
].filter(g=>g.args.length);}
export function projectPlan(spec:Spec,names:string[],base:Defaults,inherit:boolean,root='<project>'):Plan{
 const dirs=[...new Set(spec.includeDirs.map(relative))];
 const units=names.map(name=>{
  const extension=path.posix.extname(name).toLowerCase();
  if(!['.c','.cpp','.cc','.cxx'].includes(extension))throw diagnostic(spec,'add_files',undefined,'Unsupported source extension in '+JSON.stringify(name)+'.','Select .c, .cpp, .cc or .cxx files; exclude headers and resources.');
  const language:Language=spec.language??(extension==='.c'?'c':'cpp'),extra=language==='c'?spec.cflags:spec.cxxflags;
  if(inherit)check(spec,base[language],language);
  check(spec,extra,language,language==='c'?'add_cflags':'add_cxxflags');
  const args=compileLayers(spec,language,base,inherit,root).flatMap(g=>g.args);
  return {path:name,language,args};
 });
 if(inherit)check(spec,base.link,'link');
 check(spec,spec.ldflags,'link','add_ldflags');
 return {version:1,target:spec.target,units,linkLanguage:units.some(u=>u.language==='cpp')?'cpp':'c',linkArgs:linkLayers(spec,base,inherit,root).flatMap(g=>g.args),mode:spec.mode};
}
export function draftPlan(draft:Draft,config:CompilerConfig):Plan{
 if(draft.workspace){const spec=parse(draft.workspace.files['LPMake.txt']??'').spec;return projectPlan(spec,sourceNames(spec,Object.keys(draft.workspace.files)),{c:config.cArgs,cpp:config.cppArgs,link:config.linkArgs},draft.workspace.inheritDefaults);}
 const args=withDefaultStandard(draft.language==='c'?config.cArgs:config.cppArgs,draft.language);
 for(const [field,values]of [[draft.language,args],['link',config.linkArgs]] as const){const e=parameterErrors(values,field)[0];if(e)throw new Error(e.message);}
 return {version:1,target:'program',units:[{path:'main.'+(draft.language==='c'?'c':'cpp'),language:draft.language,args}],linkLanguage:draft.language,linkArgs:[...config.linkArgs],mode:'release'};
}
export function usedLanguages(draft:Draft):Language[]{
 try{
  if(!draft.workspace)return [draft.language];
  const spec=parse(draft.workspace.files['LPMake.txt']??'').spec;
  return [...new Set(sourceNames(spec,Object.keys(draft.workspace.files)).map(f=>spec.language??(/\.c$/i.test(f)?'c':'cpp')))] as Language[];
 }catch{return draft.workspace?[...new Set(Object.keys(draft.workspace.files).filter(f=>/\.(c|cpp|cc|cxx)$/i.test(f)).map(f=>/\.c$/i.test(f)?'c':'cpp'))] as Language[]:[draft.language];}
}
export function buildOptionsSignature(draft:Draft,config:CompilerConfig){
 const languages=usedLanguages(draft),driver=Object.fromEntries(languages.map(l=>[l,{kind:config.mode==='builtin'?'zig':config.kind,path:config.mode==='builtin'?'builtin':l==='c'?config.cPath:config.cppPath||(config.kind==='zig'?config.cPath:'')}]));
 try{const plan=draftPlan(draft,config);return {driver,units:plan.units,linkLanguage:plan.linkLanguage,linkArgs:plan.linkArgs};}
 catch(error){return {driver,invalid:String(error),args:draft.workspace&&!draft.workspace.inheritDefaults?undefined:Object.fromEntries(languages.map(l=>[l,l==='c'?config.cArgs:config.cppArgs])),link:draft.workspace&&!draft.workspace.inheritDefaults?undefined:config.linkArgs};}
}
export interface BuildPreview {layers:{language:Language;groups:ParameterLayer[]}[];linkLayers:ParameterLayer[];units:{path:string;language:Language;args:string[];summary:ReturnType<typeof argumentSummary>}[];linkArgs:string[];issues:ParameterIssue[];origins:string[];workDirectories:{compile:string;link:string}}
export function previewPlan(draft:Draft,config:CompilerConfig):BuildPreview{
 const plan=draftPlan(draft,config),issues:ParameterIssue[]=[],base={c:config.cArgs,cpp:config.cppArgs,link:config.linkArgs};
 const spec=draft.workspace?parse(draft.workspace.files['LPMake.txt']).spec:undefined,languages=[...new Set(plan.units.map(u=>u.language))];
 const layers=languages.map(language=>({language,groups:spec?compileLayers(spec,language,base,draft.workspace!.inheritDefaults,'<project>'):[{label:'本机或题集参数（含语言标准兜底）',args:plan.units.find(u=>u.language===language)!.args}]}));
 if(draft.workspace){
  const spec=parse(draft.workspace.files['LPMake.txt']).spec;
  for(const language of new Set(plan.units.map(u=>u.language))){
   const extra=language==='c'?spec.cflags:spec.cxxflags,own=argumentSummary(extra),full=argumentSummary(plan.units.find(u=>u.language===language)!.args),standard=spec.standards[language];
   if(own.standard&&standard&&own.standard!==standard)issues.push({severity:'warning',field:language==='c'?'cStandard':'cppStandard',language,message:'额外 '+(language==='c'?'C':'C++')+' 参数中的标准 '+own.standard+' 将覆盖此项。'});
   if(own.optimization&&own.optimization!==('-'+(spec.optimize??(spec.mode==='debug'?'O0':'O2'))))issues.push({severity:'warning',field:'optimize',language,message:'额外 '+(language==='c'?'C':'C++')+' 参数中的 '+full.optimization+' 将覆盖模式或优化设置。'});
   if(own.symbols==='-g0')issues.push({severity:'info',field:'mode',message:'额外参数 -g0 将关闭调试符号。'});
   if(own.ndebug!==undefined)issues.push({severity:'info',field:'mode',message:'额外参数对 NDEBUG 的最终设置：'+full.ndebug+'。'});
   issues.push(...relativePathAdvice([...(draft.workspace.inheritDefaults?base[language]:[]),...extra],language));
  }
  issues.push(...relativePathAdvice([...(draft.workspace.inheritDefaults?base.link:[]),...spec.ldflags],'link'),...parameterAdvice(plan.units,plan.linkArgs,config.mode==='builtin'?'zig':config.kind));
 }
 return {layers,linkLayers:spec?linkLayers(spec,base,draft.workspace!.inheritDefaults,'<project>'):[{label:'本机或题集链接参数',args:plan.linkArgs}],units:plan.units.map(u=>({...u,summary:argumentSummary(u.args)})),linkArgs:plan.linkArgs,issues:[...new Map(issues.map(i=>[i.field+i.message,i])).values()],origins:draft.workspace?[draft.workspace.inheritDefaults?'本机默认参数':'不继承本机参数','标准与模式','目录与宏','额外参数','LabPad 受控参数']:['本机或题集参数','语言标准兜底','LabPad 受控参数'],workDirectories:{compile:draft.workspace?'<project>（源码快照）':'<run>（运行临时目录）',link:draft.workspace?'<build>（构建目录）':'<run>（运行临时目录）'}};
}
