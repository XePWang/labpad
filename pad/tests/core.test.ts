import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {runProcess} from '../core/process';
import {Storage,importPairs,decodeText} from '../core/storage';
import {defaultConfig,defaultProblem} from '../shared/defaults';
import {validateProblem} from '../shared/validate';
import type {Draft,Comparison} from '../shared/types';
const root=path.resolve('..');
const compiler=new Compiler({toolchain:path.join(root,'.work/toolchains/linux-x64'),checkers:path.join(root,'.work/checkers/linux-x64')});
const settings=defaultConfig().compiler;
test.after(()=>compiler.dispose());
function draft(source:string,expected:string,comparison:Comparison={type:'wcmp'}):Draft{
 const problem=defaultProblem('Lab 2','Lab 2-1');problem.testCases=[{id:'1',input:'',expectedOutput:expected}];problem.comparison=comparison;
 return {source,language:'c',problem};
}
const printing=(text:string)=>'#include <stdio.h>\nint main(void){fputs('+JSON.stringify(text)+',stdout);return 0;}\n';
test('real bundled Zig compiles C, closes stdin, and continues after WA',async()=>{
 const d=draft('#include <stdio.h>\nint main(void){int n,s=0;while(scanf("%d",&n)==1)s+=n;printf("%d\\n",s);}', '3');
 d.problem.testCases=[{id:'1',input:'1 2',expectedOutput:'99'},{id:'2',input:'3 4\n',expectedOutput:'7'}];
 const r=await judge(compiler,d,settings);
 assert.equal(r.status,'completed',r.error);assert.deepEqual(r.cases.map(c=>c.verdict),['WA','AC']);
});
test('C remains C rather than accepting C++ source',async()=>{
 const r=await judge(compiler,draft('template<class T>T f(T x){return x;} int main(){return f(0);}',''),settings);
 assert.equal(r.compilation?.status,'CE');assert.equal(r.cases.length,0);
});
test('real C++ standard library links',async()=>{
 const d=draft('#include <iostream>\nint main(){std::cout << "hello";}','hello');d.language='cpp';
 const r=await judge(compiler,d,settings);assert.equal(r.cases[0]?.verdict,'AC',r.error||r.compilation?.stderr);
});
test('wcmp ignores whitespace but does not concatenate or normalize numbers',async()=>{
 for(const [actual,expected,verdict] of [['1\n2  3\n','1 2 3','AC'],['12','1 2','WA'],['3.0','3.00','WA'],['value 3.00','3.00','WA'],['1 2 3','1 2','WA'],['','1','WA'],['','','AC']]){
  const r=await judge(compiler,draft(printing(actual),expected),settings);
  assert.equal(r.cases[0]?.verdict,verdict,r.error||r.compilation?.stderr);
 }
});
test('floating comparisons use absolute OR relative without hidden epsilon',async()=>{
 const options:Comparison={type:'floatTokens',absoluteTolerance:.001,relativeTolerance:.000001};
 for(const [actual,expected,verdict] of [['.0005','0','AC'],['1000000.5','1000000','AC'],['101','100','WA'],['3.0','3.00','AC'],['0.001','0','AC'],['0.00100001','0','WA'],['1 2','1','WA'],['nan','1','WA'],['result 1.0001','result 1','AC'],['result:1.0001','result:1','WA']]){
  const r=await judge(compiler,draft(printing(actual),expected,options),settings);
  assert.equal(r.cases[0]?.verdict,verdict,r.error||r.compilation?.stderr);
 }
 const r=await judge(compiler,draft(printing('.0001'),'0',{type:'floatTokens',relativeTolerance:1}),settings);
 assert.equal(r.cases[0]?.verdict,'WA');
});
test('runtime failures are distinct from TLE and OLE',async()=>{
 const re=await judge(compiler,draft('int main(void){return 7;}',''),settings);
 assert.equal(re.cases[0]?.verdict,'RE');assert.equal(re.cases[0]?.exitCode,7);
 const tle=draft('int main(void){for(;;){}return 0;}','');tle.problem.timeLimitMs=150;
 assert.equal((await judge(compiler,tle,settings)).cases[0]?.verdict,'TLE');
 const ole=draft('#include <stdio.h>\nint main(void){for(;;)puts("xxxxxxxxxxxxxxxx");}','');ole.problem.outputLimitBytes=128;
 assert.equal((await judge(compiler,ole,settings)).cases[0]?.verdict,'OLE');
});
test('missing compiler and checker failures are task errors',async()=>{
 const r=await judge(compiler,draft('int main(void){return 0;}',''),{...settings,mode:'custom',kind:'gcc',cPath:'/does-not-exist',cppPath:''});
 assert.equal(r.status,'error');assert.match(r.error??'',/ENOENT/);
 const invalid=new Compiler({...compiler.paths,checkers:'/does-not-exist'});
 try{
  const r=await judge(invalid,draft('int main(void){return 0;}',''),settings);assert.equal(r.status,'error');
 }finally{await invalid.dispose();}
 const bad=await judge(compiler,draft(printing('1'),'nan',{type:'floatTokens',absoluteTolerance:1}),settings);
 assert.equal(bad.status,'error');assert.equal(bad.cases.length,0);
});
test('cancellation stops a process without manufacturing a verdict',async()=>{
 const abort=new AbortController(),dir=await mkdtemp(path.join(tmpdir(),'labpad-test-'));
 try{
  const task=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:dir,timeLimitMs:10000,outputLimitBytes:1000,signal:abort.signal});
  setTimeout(()=>abort.abort(),150);assert.equal((await task).reason,'cancelled');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('stdout limit measures bytes, stderr is drained, children are cleaned',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-test-'));
 try{
  const bytes=await runProcess(process.execPath,['-e','process.stdout.write("汉".repeat(10))'],{cwd:dir,timeLimitMs:3000,outputLimitBytes:10});
  assert.equal(bytes.reason,'output');assert.equal(bytes.stdout.length,10);
  const stderr=await runProcess(process.execPath,['-e','process.stderr.write("x".repeat(400000));process.stdout.write("ok")'],{cwd:dir,timeLimitMs:5000,outputLimitBytes:10});
  assert.equal(stderr.code,0);assert.equal(stderr.stdout.toString(),'ok');assert.equal(stderr.stderrTruncated,true);
  const child=await runProcess(process.execPath,['-e','const c=require("child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});console.log(c.pid);setTimeout(()=>process.exit(0),100);'],{cwd:dir,timeLimitMs:5000,outputLimitBytes:1000});
  const pid=Number(child.stdout.toString().trim());
  let state='unknown';
  for(let attempt=0;attempt<100;attempt++){
   try{const stat=await readFile('/proc/'+pid+'/stat','utf8');state=stat.slice(stat.lastIndexOf(')')+2).split(' ')[0];}
   catch(e:any){if(e.code==='ENOENT'){state='gone';break;}throw e;}
   if(state==='Z'||state==='X')break;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(['gone','Z','X'].includes(state),'Child '+pid+' still executing, kernel state='+state);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('source and I/O persist without imported originals',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-storage-'));
 try{
  const storage=new Storage(path.join(dir,'labpad'));const config=await storage.init();
  config.studentId='00123456';config.compiler.cArgs.push('-DVALUE=7');await storage.saveConfig(config);
  const imported=path.join(dir,'imports');await mkdir(imported);
  await writeFile(path.join(imported,'1.IN'),'5 6');await writeFile(path.join(imported,'1.OUT'),'11\n');
  const p=await importPairs([path.join(imported,'1.IN'),path.join(imported,'1.OUT')],'Lab 2','Lab 2-1');
  await storage.save({source:'// 中文\nint main(void){return 0;}',language:'c',problem:p});
  await rm(imported,{recursive:true});const restored=new Storage(storage.root);
  assert.equal((await restored.init()).studentId,'00123456');
  assert.match((await restored.load('Lab 2','Lab 2-1','c')).source,/中文/);
  assert.equal((await restored.load('Lab 2','Lab 2-1','c')).problem.testCases[0].expectedOutput,'11\n');
  const raw=await readFile(storage.paths('Lab 2','Lab 2-1','c').source);assert.notEqual(raw.subarray(0,3).toString('hex'),'efbbbf');
  await assert.rejects(restored.load('../escape','Lab 1-1','c'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid rules and broken configs do not silently reset user files',async()=>{
 const p=defaultProblem('Lab 1','Lab 1-1');p.comparison={type:'floatTokens'};
 assert.throws(()=>validateProblem(p));
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-storage-'));
 try{
  await writeFile(path.join(dir,'config.json'),'{broken');
  await assert.rejects(new Storage(dir).init());
  assert.equal(await readFile(path.join(dir,'config.json'),'utf8'),'{broken');
 }finally{await rm(dir,{recursive:true,force:true});}
 assert.equal(decodeText(Buffer.from([0xd6,0xd0,0xce,0xc4])).text,'中文');
});

test('a new problem with no test data never reports accepted',async()=>{
 const d=draft('int main(void){return 0;}','');d.problem.testCases=[];
 const result=await judge(compiler,d,settings);
 assert.equal(result.status,'error');assert.equal(result.compilation,undefined);assert.equal(result.cases.length,0);
});

test('empty selection, project creation and export names work without identity',async()=>{
 const {exportName}=await import('../core/storage');
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-projects-'));
 try{
  const s=new Storage(dir),c=await s.init();assert.equal(c.currentLab,'');assert.equal(c.currentProblem,'');assert.equal(c.saveMode,'manual');
  const d:Draft={source:'int main(void){return 0;}',language:'c',problem:defaultProblem('','')};
  assert.equal(exportName(d,''),'空项目.c');assert.equal(exportName(d,'12345678'),'12345678_空项目.c');
  d.language='cpp';assert.equal(exportName(d,''),'空项目.cpp');
  await s.save(d);assert.equal((await s.load('','','cpp')).source,d.source);assert.deepEqual(await s.projects(),[]);
  await s.createLab('实验 A');await s.createProblem('实验 A','第 1 题','c');
  assert.deepEqual(await s.projects(),[{labId:'实验 A',problems:['第 1 题']}]);
  await assert.rejects(s.createLab('实验 A'));await assert.rejects(s.createProblem('实验 A','第 1 题','c'));
  d.problem=defaultProblem('实验 A','第 1 题');assert.equal(exportName(d,'12345678'),'12345678_第 1 题.cpp');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('importing only I/O leaves the current source file untouched',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-rule-only-'));
 try{
  const s=new Storage(dir);await s.init();await s.createLab('Lab 2');const d=await s.createProblem('Lab 2','Lab 2-1','c');
  const file=s.paths('Lab 2','Lab 2-1','c').source,before=await readFile(file,'utf8');
  d.source='unsaved replacement';d.problem.testCases=[{id:'1',input:'1',expectedOutput:'2'}];await s.save(d,false);
  assert.equal(await readFile(file,'utf8'),before);assert.equal((await s.load('Lab 2','Lab 2-1','c')).problem.testCases[0].input,'1');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('data relocation copies saved data and rejects an occupied target',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'labpad-relocate-'));
 try{
  const s=new Storage(path.join(root,'old'));const c=await s.init();c.studentId='12345678';await s.saveConfig(c);
  await s.createLab('Lab 2');const d=await s.createProblem('Lab 2','Lab 2-1','c');d.source='// preserved';await s.save(d);
  const target=path.join(root,'new');await mkdir(target);await s.copyDataTo(target);
  const next=new Storage(target);await next.saveConfig(c);
  assert.equal((await next.init()).studentId,'12345678');assert.equal((await next.load('Lab 2','Lab 2-1','c')).source,'// preserved');
  assert.equal((await s.load('Lab 2','Lab 2-1','c')).source,'// preserved');
  await assert.rejects(s.copyDataTo(target));assert.equal((await next.load('Lab 2','Lab 2-1','c')).source,'// preserved');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('old dev configs gain manual saving without changing existing identity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-upgrade-'));
 try{
  const c:any=defaultConfig();delete c.saveMode;delete c.sourceFile;delete c.indentSize;delete c.theme;delete c.formatOnSave;delete c.layout;c.studentId='00123456';c.currentLab='Lab 2';c.currentProblem='Lab 2-1';
  await writeFile(path.join(dir,'config.json'),JSON.stringify(c));const upgraded=await new Storage(dir).init();
  assert.deepEqual(upgraded.layout,{editorPercent:53,outputPercent:28});assert.equal(upgraded.indentSize,4);assert.equal(upgraded.theme,'dark');assert.equal(upgraded.formatOnSave,true);assert.equal(upgraded.saveMode,'manual');assert.equal(upgraded.studentId,'00123456');assert.equal(upgraded.currentProblem,'Lab 2-1');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('real WASM clang-format wraps, joins, preserves strings and respects all indent sizes',async()=>{
 const {Formatter}=await import('../core/formatter');
 const {createRequire}=await import('node:module');
 const formatter=new Formatter(path.join(root,'.work/build/electron/formatter-worker.cjs'),createRequire(path.join(root,'pad/package.json')).resolve('@wasm-fmt/clang-format/node'));
 try{
  const source='#include <stdio.h>\nint\nsum(\nint a,\nint b\n){return a+b;}\nint main(void){printf("中文\\t%d\\n",sum(10,32));return 0;}\n';
  for(const indent of [1,2,4]){
   const formatted=await formatter.format(source,'c',indent);
   assert.match(formatted,/int sum\(int a, int b\) \{/);
   assert.ok(formatted.includes('\n'+' '.repeat(indent)+'return a + b;'));
   assert.ok(!formatted.includes('\t'));
   const judged=await judge(compiler,draft(formatted,'中文\t42\n'),settings);
   assert.equal(judged.cases[0]?.verdict,'AC',judged.error||judged.compilation?.stderr);
   assert.equal(await formatter.format(formatted,'c',indent),formatted);
  }
  const long='int main(void){return function_with_long_name(first_long_parameter_name,second_long_parameter_name,third_long_parameter_name,fourth_long_parameter_name);}\n';
  const wrapped=await formatter.format(long,'c',4);assert.ok(wrapped.split('\n').every(line=>line.length<=80));
  const cpp=await formatter.format('template<class T>T twice(T x){return x+x;}','cpp',2);assert.match(cpp,/template/);
  const [one,four]=await Promise.all([formatter.format('int f(){return 1;}','c',1),formatter.format('int f(){return 2;}','c',4)]);
  assert.ok(one.includes('\n return 1;'));assert.ok(four.includes('\n    return 2;'));
 }finally{await formatter.dispose();}
});
test('atomic original-file writes leave prior contents intact on failure',async()=>{
 const {writeSource}=await import('../core/storage');
 const {chmod}=await import('node:fs/promises');
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-atomic-')),file=path.join(dir,'source.c');
 try{
  await writeFile(file,'original');await chmod(dir,0o500);
  await assert.rejects(writeSource(file,'new content'));assert.equal(await readFile(file,'utf8'),'original');
  await chmod(dir,0o700);await writeSource(file,'// 中文\nint main(void){return 0;}');
  assert.match(await readFile(file,'utf8'),/中文/);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(dir),['source.c']);
 }finally{await chmod(dir,0o700);await rm(dir,{recursive:true,force:true});}
});

test('layout settings accept adjustable proportions and reject invalid bounds',async()=>{
 const {validateLayout}=await import('../shared/validate');
 assert.deepEqual(validateLayout({editorPercent:61.5,outputPercent:39.2}),{editorPercent:61.5,outputPercent:39.2});
 for(const layout of [null,{editorPercent:19,outputPercent:28},{editorPercent:81,outputPercent:28},{editorPercent:53,outputPercent:11},{editorPercent:53,outputPercent:66},{editorPercent:NaN,outputPercent:28}])assert.throws(()=>validateLayout(layout));
});
