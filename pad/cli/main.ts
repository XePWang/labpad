import path from 'node:path';
import {existsSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {defaultProblem} from '../shared/defaults';
import {parseTestCases,parseLabPackage,labDraft} from '../shared/project-format';
import {readJSON,decodeText} from '../core/storage';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {runGrade,compilerConfig} from './grade';
const platform=process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux';
const resources=process.env.LABPAD_RESOURCES??(existsSync(path.join(__dirname,'resources'))?path.join(__dirname,'resources'):path.resolve(__dirname,'../../../.work'));
const checks=existsSync(path.join(resources,'checkers','wcmp'+(process.platform==='win32'?'.exe':'')))?path.join(resources,'checkers'):path.join(resources,'checkers',platform+'-'+process.arch);
const paths={toolchain:path.join(resources,'toolchain'),checkers:checks,processHost:process.platform==='win32'?path.join(checks,'process-host.exe'):undefined};
const help=`LabPad 命令行 · 0.1.0-dev.7
用法：
  labpad judge --source solution.c --tests problem.io.json --compiler gcc
  labpad judge --source solution.c --tests project.json --problem "Lab 2-1"
  labpad grade lab2
  labpad grade lab2 --student 7355608
选项：
  --compiler gcc|clang|zig  单文件工具链（默认 gcc）
  --cc 路径 --cxx 路径     指定 C / C++ 编译器
  --json                   单文件结果输出为 JSON
  --student 学号           仅重测此学生，保留其他行与评语
项目批测读取目录中的 grade.json；部署与 CSV 字段见助教指南。
`;
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{source:{type:'string'},tests:{type:'string'},compiler:{type:'string'},cc:{type:'string'},cxx:{type:'string'},student:{type:'string'},problem:{type:'string'},json:{type:'boolean'},help:{type:'boolean',short:'h'}}});
 if(values.help||!positionals.length){console.log(help);return;}
 const abort=new AbortController();process.once('SIGINT',()=>abort.abort());
 if(positionals[0]==='grade'){
  if(positionals.length!==2)throw Error('请指定实验目录，例如：labpad grade lab2');
  await runGrade(positionals[1],paths,{studentId:values.student,signal:abort.signal,progress:message=>console.log(message)});return;
 }
 if(positionals[0]!=='judge'||!values.source||!values.tests)throw Error('请指定 --source 与 --tests，或使用 --help 查看示例。');
 const file=path.resolve(values.source),language=file.toLowerCase().endsWith('.cpp')?'cpp':'c';
 if(!/\.(c|cpp)$/i.test(file))throw Error('单文件仅支持 .c / .cpp');
 const raw=await readJSON(path.resolve(values.tests)) as Record<string,unknown>;
 const problem=raw.kind==='labpad.project'?(()=>{
  const pkg=parseLabPackage(raw),item=pkg.problems.find(p=>p.problemId===values.problem);
  if(!item)throw Error('请用 --problem 指定项目中的题号');return labDraft(pkg,item).problem;
 })():parseTestCases(raw,defaultProblem('',''));
 const config=await compilerConfig({kind:(values.compiler??'gcc') as 'gcc'|'clang'|'zig',...(values.cc?{cPath:values.cc}:{}),...(values.cxx?{cppPath:values.cxx}:{})}),compiler=new Compiler(paths);
 try{
  const result=await judge(compiler,{source:decodeText(await readFile(file)).text,language,problem},config,abort.signal);
  if(values.json)console.log(JSON.stringify(result,null,2));
  else{
   console.log('编译：'+(result.compilation?.status??'未完成'));if(result.compilation?.stderr)console.log(result.compilation.stderr);
   for(const c of result.cases)console.log(c.id+' · '+(c.verdict??c.status)+' · '+c.elapsedMs+' ms'+(c.message?' · '+c.message.trim():''));
   if(result.error)console.error(result.error);
  }
  process.exitCode=result.status==='completed'&&result.compilation?.status==='success'&&result.cases.length>0&&result.cases.every(c=>c.verdict==='AC')?0:result.status==='error'?2:1;
 }finally{await compiler.dispose();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=2;});
