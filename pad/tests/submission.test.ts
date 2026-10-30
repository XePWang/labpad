import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {unzipSync,strFromU8} from 'fflate';
import {Storage} from '../core/storage';
import {Formatter} from '../core/formatter';
import {defaultConfig,defaultProblem,defaultSource} from '../shared/defaults';
import {parseLabPackage,parseTestCases,labDraft} from '../shared/project-format';
import {prepareSource,prepareProject,submissionZip,fingerprint,checkRecord} from '../core/submission';
import type {Draft,JudgeResult} from '../shared/types';
const root=path.resolve('..'),formatter=new Formatter(path.join(root,'.work/build/electron/formatter-worker.cjs'),createRequire(path.join(root,'pad/package.json')).resolve('@wasm-fmt/clang-format/node'));
test.after(()=>formatter.dispose());
const services={identity:async()=>'compiler-v1',format:(source:string,language:'c'|'cpp')=>formatter.format(source,language,4)};
const packageValue=()=>({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[
 {problemId:'warmup 2-1',source:['#include <stdio.h>','int main(void) {','    puts("starter");','    return 0;','}'],testCases:[{id:'1',input:'',expectedOutput:'starter\n'}]},
 {problemId:'Lab 2-1',language:'cpp',source:'#include <iostream>\nint main() { std::cout << "next"; }\n',testCases:[{id:'1',input:'',expectedOutput:'next'}]}
]});
async function temporary(fn:(s:Storage,dir:string)=>Promise<void>){
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-package-'));try{const s=new Storage(dir);await s.init();await fn(s,dir);}finally{await chmod(path.join(dir,'projects'),0o700).catch(()=>{});await rm(dir,{recursive:true,force:true});}
}
function passed(d:Draft):JudgeResult{return {status:'completed',compiler:'test',comparison:d.problem.comparison,compilation:{status:'success',stdout:'',stderr:'',command:[],elapsedMs:1},cases:d.problem.testCases.map(t=>({id:t.id,status:'completed',verdict:'AC',elapsedMs:1,stdout:t.expectedOutput,stderr:'',exitCode:0,signal:null,message:''}))};}
const fullIdentity=()=>({...defaultConfig(),classId:'240101',name:'张三',studentId:'12345678'});
test('project JSON accepts C/C++ presets, source lines and defaults while rejecting invalid names and duplicate IDs',async()=>{
 const example=parseLabPackage(JSON.parse(await readFile(path.join(root,'examples/lab-2.project.json'),'utf8')));assert.equal(example.labId,'实验2');assert.equal(example.problems.length,8);assert.equal(example.problems[0].problemId,'warmup 2-1');
 const io=parseTestCases(JSON.parse(await readFile(path.join(root,'examples/sum.io.json'),'utf8')),defaultProblem('实验2','warmup 2-1'));assert.equal(io.testCases[0].input,'1 2\n');
 const p=parseLabPackage(packageValue());assert.equal(p.labId,'实验2');assert.equal(p.problems[0].language,'c');assert.match(p.problems[0].source,/\n/);assert.equal(p.problems[1].language,'cpp');assert.equal(p.problems[0].comparison.type,'wcmp');
 assert.equal(parseLabPackage({schemaVersion:1,kind:'labpad.project',labId:'空题',problems:[{problemId:'1'}]}).problems[0].source,defaultSource('c'));
 for(const value of [null,{...packageValue(),schemaVersion:2},{...packageValue(),problems:[]},{...packageValue(),labId:'../x'},
  {...packageValue(),problems:[{problemId:'A'},{problemId:'a'}]}, {...packageValue(),problems:[{problemId:'../a'}]},
  {...packageValue(),problems:[{problemId:'a',language:'python'}]}, {...packageValue(),problems:[{problemId:'a',source:['two\nlines']}]},
  {...packageValue(),problems:[{problemId:'a',comparison:{type:'floatTokens',absoluteTolerance:-1}}]}])assert.throws(()=>parseLabPackage(value));
});
test('standard I/O import replaces only cases and explicit rules, preserving current project, problem and title',()=>{
 const current=defaultProblem('实验2','Lab 2-1');current.title='当前题';current.comparison={type:'floatTokens',absoluteTolerance:.01};current.timeLimitMs=2345;
 const old={...defaultProblem('其他项目','其他题'),testCases:[{id:'1',input:'1',expectedOutput:'2'}]};
 const legacy=parseTestCases(old,current);assert.equal(legacy.labId,'实验2');assert.equal(legacy.problemId,'Lab 2-1');assert.equal(legacy.title,'当前题');
 const value=parseTestCases({kind:'labpad.testCases',schemaVersion:1,testCases:old.testCases},current);
 assert.deepEqual(value.comparison,current.comparison);assert.equal(value.timeLimitMs,2345);assert.deepEqual(current.testCases,[]);
 assert.throws(()=>parseTestCases(packageValue(),current),/导入实验项目/);
 assert.throws(()=>parseTestCases({schemaVersion:1,kind:'other',testCases:[]},current));
});
test('whole project import is staged, ordered, preserves old data and recovers after a failed atomic rename',async()=>{
 await temporary(async(s,dir)=>{
  await s.importProject(packageValue());assert.deepEqual(await s.projects(),[{labId:'实验2',problems:['warmup 2-1','Lab 2-1']}]);
  const cpp=await s.load('实验2','Lab 2-1','c',true);assert.equal(cpp.language,'cpp');assert.match(cpp.source,/iostream/);
  const meta=await s.projectState('实验2','warmup 2-1','c');assert.equal(meta.starters.c,parseLabPackage(packageValue()).problems[0].source);
  assert.equal(await s.nextLabName('实验2'),'实验2 (2)');
  await assert.rejects(s.importProject({...packageValue(),problems:[{problemId:'../bad'}]}));assert.equal((await s.projects()).length,1);
  await assert.rejects(s.importProject(packageValue()));assert.match((await s.load('实验2','Lab 2-1','c',true)).source,/iostream/);
  await s.importProject(packageValue(),'实验2 (2)');assert.equal((await s.projects()).length,2);
  await chmod(path.join(dir,'projects'),0o500);await assert.rejects(s.importProject(packageValue(),'failed'));await chmod(path.join(dir,'projects'),0o700);
  assert.ok(!(await readdir(dir)).some(n=>n.startsWith('.import-')));assert.equal((await s.projects()).length,2);
  await s.importProject(packageValue(),'实验2 (3)');assert.equal((await s.projects()).length,3);
 });
});
test('legacy source bindings remain readable before adoption and relocation',async()=>{
 await temporary(async(s,dir)=>{
  const folder=path.join(dir,'projects','旧项目');await mkdir(folder,{recursive:true});
  const p=defaultProblem('旧项目','旧题');await writeFile(path.join(folder,'旧题.json'),JSON.stringify(p));await writeFile(path.join(folder,'旧题.cpp'),'// legacy cpp');
  assert.equal((await s.load('旧项目','旧题','c',true)).language,'cpp');
  await s.importProject(packageValue());const external=path.join(dir,'original.cpp');await writeFile(external,'// external source');
  await s.bindSource('实验2','Lab 2-1','cpp',external,'UTF-8');
  assert.equal((await s.load('实验2','Lab 2-1','c',true)).sourceFile,external);
  const target=path.join(dir,'relocated');await mkdir(target);await s.copyDataTo(target);const relocated=new Storage(target);
  assert.equal((await relocated.load('实验2','Lab 2-1','c',true)).source,'// external source');
  await rm(external);const fallback=await s.load('实验2','Lab 2-1','c',true);assert.match(fallback.warning??'',/关联源码无法读取/);assert.match(fallback.source,/iostream/);
 });
});
test('submission ZIP uses project name verbatim, includes mixed-language source only and snapshots unsaved and linked files',async()=>{
 await temporary(async(s,dir)=>{
  await s.importProject(packageValue());const d=await s.load('实验2','warmup 2-1','c',true);d.source='// unsaved editor\nint main(void) { return 0; }\n';
  const external=path.join(dir,'linked.cpp');await writeFile(external,'// latest external\nint main() { return 1; }\n');await s.bindSource('实验2','Lab 2-1','cpp',external,'UTF-8');
  const prepared=await prepareProject(s,d,fullIdentity(),services);assert.equal(prepared.name,'240101_张三_12345678_实验2.zip');
  const entries=unzipSync(submissionZip(prepared)),prefix='240101_张三_12345678_实验2/';
  assert.deepEqual(Object.keys(entries),[prefix+'12345678_warmup 2-1.c',prefix+'12345678_Lab 2-1.cpp']);
  assert.equal(strFromU8(entries[prefix+'12345678_warmup 2-1.c']),d.source);assert.match(strFromU8(entries[prefix+'12345678_Lab 2-1.cpp']),/latest external/);
  d.source='after preparation';assert.ok(!strFromU8(unzipSync(submissionZip(prepared))[prefix+'12345678_warmup 2-1.c']).includes('after preparation'));
  assert.notEqual((await s.load('实验2','warmup 2-1','c')).source,d.source);
 });
});
test('unedited detection handles imported presets, empty code and format-only changes using real clang-format',async()=>{
 await temporary(async s=>{
  await s.importProject(packageValue());const d=await s.load('实验2','warmup 2-1','c',true);
  d.source=await formatter.format(d.source,'c',2);let prepared=await prepareProject(s,d,fullIdentity(),services);assert.match(prepared.warnings.join('\n'),/未编辑源码：warmup 2-1、Lab 2-1/);
  d.source+='// student changed the code\n';prepared=await prepareProject(s,d,fullIdentity(),services);assert.ok(!prepared.warnings.find(w=>w.startsWith('未编辑源码'))?.includes('warmup'));
  d.source=' \n';prepared=await prepareProject(s,d,fullIdentity(),services);assert.match(prepared.warnings.join('\n'),/未编辑源码：warmup/);
 });
});
test('source identity warnings retain optional export names; empty project refuses whole-project export',async()=>{
 await temporary(async s=>{
  const d:Draft={language:'c',source:'int main(void){return 0;}',problem:defaultProblem('','')},config=defaultConfig();
  let p=await prepareSource(s,d,config,services);assert.equal(p.name,'空项目.c');assert.match(p.warnings.join('\n'),/班号、姓名、学号/);assert.match(p.warnings.join('\n'),/未设置测试点/);
  config.studentId=' 12345678 ';d.language='cpp';p=await prepareSource(s,d,config,services);assert.equal(p.name,'12345678_空项目.cpp');assert.ok(!p.warnings.find(w=>w.includes('身份'))?.includes('学号'));
  await assert.rejects(prepareProject(s,d,config,services));
  await s.importProject(packageValue());const current=await s.load('实验2','warmup 2-1','c');const project=await prepareProject(s,current,defaultConfig(),services);
  assert.equal(project.name,'未填班号_未填姓名_未填学号_实验2.zip');
 });
});
test('accepted records persist; source, tests, limits and compiler changes require a new run; titles do not',async()=>{
 await temporary(async s=>{
  await s.importProject(packageValue());const d=await s.load('实验2','warmup 2-1','c'),config=fullIdentity(),hash=fingerprint(d,config.compiler,'compiler-v1');
  assert.match((await prepareSource(s,d,config,services)).warnings.join(''),/尚未测试/);
  await s.recordCheck(d,checkRecord(d,hash,passed(d)));assert.deepEqual((await prepareSource(new Storage(s.root),d,config,services)).warnings,[]);
  const title=structuredClone(d);title.problem.title='renamed';assert.deepEqual((await prepareSource(s,title,config,services)).warnings,[]);
  for(const mutate of [(v:Draft)=>{v.source+=' ';},(v:Draft)=>{v.problem.testCases[0].input='9';},(v:Draft)=>{v.problem.timeLimitMs++;},
   (v:Draft)=>{v.problem.comparison={type:'floatTokens',absoluteTolerance:.1};}]){
   const changed=structuredClone(d);mutate(changed);assert.match((await prepareSource(s,changed,config,services)).warnings.join(''),/需重新测试/);
  }
  assert.match((await prepareSource(s,d,{...config,compiler:{...config.compiler,cArgs:['-O0']}},services)).warnings.join(''),/需重新测试/);
  assert.match((await prepareSource(s,d,config,{...services,identity:async()=>'compiler-v2'})).warnings.join(''),/需重新测试/);
 });
});
test('running, cancellation, failure, task errors and zero tests never reuse a past accepted result',async()=>{
 await temporary(async s=>{
  await s.importProject(packageValue());const d=await s.load('实验2','warmup 2-1','c'),config=fullIdentity(),hash=fingerprint(d,config.compiler,'compiler-v1');
  for(const result of [undefined,{...passed(d),status:'cancelled' as const},{...passed(d),status:'error' as const},
   {...passed(d),cases:[]},{...passed(d),compilation:{...passed(d).compilation!,status:'CE' as const}}]){
   await s.recordCheck(d,checkRecord(d,hash,result));assert.ok((await prepareSource(s,d,config,services)).warnings.some(w=>w.startsWith('尚未全部通过')));
  }
  d.problem.testCases=[];assert.notEqual(checkRecord(d,hash,passed(d)).status,'passed');
 });
});
