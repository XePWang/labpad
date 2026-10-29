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
