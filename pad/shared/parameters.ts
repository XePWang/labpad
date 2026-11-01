import type {Language} from './types';
export interface ParameterIssue {severity:'error'|'warning'|'info';field:string;message:string;reason?:string;hint?:string;index?:number;language?:Language}
export interface ArgumentToken {key:string;value?:string;index:number}
export interface ArgumentSummary {standard?:string;optimization?:string;symbols?:string;ndebug?:string}
const values=new Set(['-o','--output','-x','--language','-I','-L','-include','-imacros','-isystem','-iquote','-idirafter','-D','-U','--std','-isysroot','--sysroot','-target','--target','-MF','-MT','-MQ','-Xclang','-Xlinker','-Xpreprocessor','-Xassembler','-object-file-name','-B','-arch']);
const reserved=new Set(['-o','--output','-c','-S','-E','--compile','--assemble','--preprocess','-M','-MM','--dependencies','--user-dependencies','-x','--language','-xc','-xc++','-xnone']);
export function argumentTokens(args:readonly string[]):ArgumentToken[]{
 const result:ArgumentToken[]=[];
 for(let i=0;i<args.length;i++){
  const arg=args[i],index=i;
  if(values.has(arg)){result.push({key:arg,value:args[++i],index});continue;}
  const eq=/^(--(?:output|language|std|sysroot|target)|-std|-fsanitize|-fno-sanitize|-fsanitize-trap|-fno-sanitize-trap|-flto|-fopenmp)=(.*)$/s.exec(arg);
  if(eq){result.push({key:eq[1],value:eq[2],index});continue;}
  const joined=/^(-I|-L|-D|-U)(.+)$/s.exec(arg);
  if(joined){result.push({key:joined[1],value:joined[2],index});continue;}
  result.push({key:arg,index});
 }
 return result;
}
export function parameterErrors(args:readonly string[],field:string):ParameterIssue[]{
 const result:ParameterIssue[]=[];
 for(const t of argumentTokens(args)){
  if(reserved.has(t.key)){
   const language=['-x','--language','-xc','-xc++','-xnone'].includes(t.key);
   result.push({severity:'error',field,index:t.index,message:language?'编译语言由对应字段管理，请移除此参数。':'输出位置与编译阶段由 LabPad 管理，请移除此参数。',reason:language?'Input language is managed by LabPad.':'Output selection and compilation stages are managed by LabPad.',hint:language?'Remove this argument. Set the project language with set_language(), or select the source language in problem-set mode.':'Remove this argument and its value, if any. LabPad supplies the build stages and output paths.'});
  }else if(values.has(t.key)&&(t.value===undefined||t.value==='')){
   result.push({severity:'error',field,index:t.index,message:t.key+' 后缺少参数值，请在下一行填写。',reason:'Missing value after '+JSON.stringify(t.key)+'.',hint:'Add the value as the next argument. Each line or string represents one process argument.'});
  }
 }
 return result;
}
export function assertParameters(args:readonly string[],field:string){const issue=parameterErrors(args,field)[0];if(issue)throw new Error(field+'：'+issue.message);}
export function argumentSummary(args:readonly string[]):ArgumentSummary{
 const result:ArgumentSummary={};
 for(const t of argumentTokens(args)){
  if(t.key==='-std'||t.key==='--std')result.standard=t.value;
  else if(t.key==='-ansi'||t.key==='--ansi')result.standard='ANSI';
  else if(/^-O(?:[0-3sgz]|fast)?$/.test(t.key))result.optimization=t.key==='-O'?'-O1':t.key;
  else if(t.key==='-g'||/^-g[0-3]$/.test(t.key))result.symbols=t.key;
  else if((t.key==='-D'||t.key==='-U')&&t.value?.split('=')[0]==='NDEBUG')result.ndebug=t.key==='-U'?'未定义':t.value.includes('=')?t.value.split('=').slice(1).join('='):'1';
 }
 return result;
}
function switches(args:readonly string[]){
 const tokens=argumentTokens(args),keys=new Set(tokens.map(t=>t.key)),sanitizers=new Set<string>();let lto=false,openmp=false,trap=false,coverage=false;
 for(const t of tokens){
  if(t.key==='-fsanitize'||t.key==='-fno-sanitize')for(const value of (t.value??'').split(',')){if(t.key==='-fsanitize')sanitizers.add(value);else if(value==='all')sanitizers.clear();else sanitizers.delete(value);}
  if(['--coverage','-coverage','-fprofile-arcs'].includes(t.key))coverage=true;if(t.key==='-fno-profile-arcs')coverage=false;
  if(t.key==='-flto')lto=true;if(t.key==='-fno-lto')lto=false;
  if(t.key==='-fopenmp')openmp=true;if(t.key==='-fno-openmp')openmp=false;
  if(t.key==='-fsanitize-trap'||t.key==='-fsanitize-undefined-trap-on-error')trap=true;
  if(t.key==='-fno-sanitize-trap')trap=false;
 }
 return {tokens,keys,sanitizers,lto,openmp,trap,coverage};
}
export function parameterAdvice(compiles:{language:Language;args:string[]}[],linkArgs:string[],kind:string):ParameterIssue[]{
 const issues:ParameterIssue[]=[],link=switches(linkArgs),linkKeys=link.keys;
 const note=(message:string,severity:'warning'|'info'='warning')=>{if(!issues.some(i=>i.message===message))issues.push({severity,field:'link',message});};
 for(const unit of compiles){
  const flags=switches(unit.args);
  if(flags.keys.has('-pthread')&&!linkKeys.has('-pthread')&&!linkKeys.has('-lpthread'))note('多文件项目分别编译和链接；-pthread 通常也需要加入额外链接参数。');
  if(flags.openmp&&!link.openmp&&!['-lgomp','-lomp','-liomp5'].some(k=>linkKeys.has(k)))note('已启用 OpenMP；请核对链接参数及当前工具链的 OpenMP 运行库。');
  if(flags.keys.has('-pg')&&!linkKeys.has('-pg'))note('-pg 通常需要同时用于编译与链接。');
  const coverage=flags.coverage;
  if(coverage&&!link.coverage&&!linkKeys.has('-lgcov'))note('已启用覆盖率插桩；请核对额外链接参数中的覆盖率开关或运行库。');
  const missing=[...flags.sanitizers].filter(s=>s&&!link.sanitizers.has(s));
  if(missing.length){
   const explicitLibrary=[...linkKeys].some(k=>/^-l(?:asan|ubsan|tsan|msan|lsan|clang_rt)/.test(k));
   note(flags.trap||explicitLibrary?'已配置 sanitizer 的 trap 模式或显式运行库，请在生效参数中核对编译与链接的配合。':'Sanitizer 编译检查 '+missing.join(', ')+' 未检测到对应链接开关；请核对链接参数。',flags.trap||explicitLibrary?'info':'warning');
  }
  if(flags.lto&&!link.lto)note(linkKeys.has('-fno-lto')?'链接参数显式关闭了 LTO，编译阶段的 LTO 请求不会自动沿用。':kind==='gcc'?'GCC 可从 LTO 对象自动启用链接优化；实际链接参数见下方。':'已启用 LTO；请核对当前工具链的链接器与链接选项。','info');
 }
 return issues;
}
export function relativePathAdvice(args:readonly string[],field:string):ParameterIssue[]{
 const result:ParameterIssue[]=[];
 for(const t of argumentTokens(args)){
  if(!['-I','-L','-include','-imacros','-isystem','-iquote','-idirafter'].includes(t.key)||!t.value||/^(?:[\\/]|[a-z]:[\\/])/i.test(t.value))continue;
  const message=t.key==='-L'?'相对库路径按链接工作目录解析；建议使用“库目录”字段。':t.key==='-include'||t.key==='-imacros'?'强制包含文件按编译工作目录解析；请核对该相对文件路径。':'相对包含路径按编译工作目录解析；建议使用“包含目录”字段。';
  if(!result.some(i=>i.message===message))result.push({severity:'info',field,message});
 }
 return result;
}
