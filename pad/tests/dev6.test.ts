import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Storage,decodeText,writeSource} from '../core/storage';
import {defaultConfig,defaultProblem} from '../shared/defaults';
import {validateProblem} from '../shared/validate';
import {parseTestCases,parseLabPackage} from '../shared/project-format';
import {fingerprint,checkRecord,prepareSource} from '../core/submission';
import {validateShortcuts,defaultShortcuts} from '../shared/shortcuts';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {CompilerCache} from '../core/cache';
const root=path.resolve('..'),options=defaultConfig().compiler;
test('per-case comparison inherits defaults and overrides in both directions; real checkers and fingerprints agree',async()=>{
 const compiler=new Compiler({toolchain:path.join(root,'.work/toolchains/linux-x64'),checkers:path.join(root,'.work/checkers/linux-x64')});
 try{
  const d={source:'#include <stdio.h>\nint main(void){puts("3.0");}',language:'c' as const,problem:defaultProblem('实验2','Lab 2-1')};
  d.problem.testCases=[{id:'exact',input:'',expectedOutput:'3.00'},{id:'float',input:'',expectedOutput:'3.00',comparison:{type:'floatTokens',absoluteTolerance:0}}];
  assert.deepEqual((await judge(compiler,d,options)).cases.map(c=>c.verdict),['WA','AC']);
  d.problem.comparison={type:'floatTokens',relativeTolerance:0};
  d.problem.testCases[0].comparison={type:'wcmp'};
  assert.deepEqual((await judge(compiler,d,options)).cases.map(c=>c.verdict),['WA','AC']);
  delete d.problem.testCases[0].comparison;
  assert.deepEqual((await judge(compiler,d,options)).cases.map(c=>c.verdict),['AC','AC']);
  const hash=fingerprint(d,options,'tool');d.problem.testCases[0].comparison={type:'wcmp'};assert.notEqual(fingerprint(d,options,'tool'),hash);
 }finally{await compiler.dispose();}
});
test('partial floating rules survive both JSON imports and reject invalid overrides before changes',()=>{
 const current=defaultProblem('实验2','Lab 2-1'),testCases=[{id:'1',input:'',expectedOutput:'1'},{id:'2',input:'',expectedOutput:'1',comparison:{type:'floatTokens',absoluteTolerance:.001}}];
 assert.deepEqual(parseTestCases({schemaVersion:1,testCases},current).testCases,testCases);
 assert.deepEqual(parseLabPackage({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases}]}).problems[0].testCases,testCases);
 for(const comparison of [null,{}, {type:'floatTokens'}, {type:'floatTokens',absoluteTolerance:-1}, {type:'floatTokens',absoluteTolerance:'0.1'}, {type:'floatTokens',relativeTolerance:Infinity}])
  assert.throws(()=>validateProblem({...current,testCases:[{id:'bad',input:'',expectedOutput:'',comparison}]}),/bad/);
});
test('imports create owned versions, same-topic imports reopen, other-topic imports copy; external originals stay intact',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-versions-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();await storage.createLab('实验2');await storage.createProblem('实验2','Lab 2-1','c');
  const original=path.join(dir,'原始.c');await writeFile(original,'// original');
  const imported=await storage.importSource('实验2','Lab 2-1',original);assert.notEqual(imported.sourceFile,original);
  await storage.save({...imported,source:'// modified'});assert.equal(await readFile(original,'utf8'),'// original');assert.equal(await readFile(imported.sourceFile!,'utf8'),'// modified');
  const again=await storage.importSource('实验2','Lab 2-1',imported.sourceFile!);assert.equal(again.documentId,imported.documentId);
  await storage.createProblem('实验2','Lab 2-2','c');
  const other=await storage.importSource('实验2','Lab 2-2',imported.sourceFile!);assert.notEqual(other.sourceFile,imported.sourceFile);assert.equal(other.source,'// modified');
  const external=await storage.importSource('','',original);assert.equal(external.sourceFile,await (await import('node:fs/promises')).realpath(original));
  await storage.save({...external,source:'// write back'});assert.equal(await readFile(original,'utf8'),'// write back');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('only latest five versions reopen, old versions remain importable; active language and per-version pass evidence persist',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-versions-'));
 try{
  const storage=new Storage(dir);await storage.init();await storage.createLab('实验2');let d=await storage.createProblem('实验2','Lab 2-1','c');
  const versions:Awaited<ReturnType<Storage['newVersion']>>[]=[];for(let i=0;i<7;i++){const version=await storage.newVersion({...d,source:'// '+i});versions.push(version);await utimes(version.sourceFile!,new Date(100000+i*1000),new Date(100000+i*1000));}
  const filesBefore=await readdir(path.join(dir,'projects','实验2'));
  // Make the original template older than the versions.
  await utimes(storage.paths('实验2','Lab 2-1','c').source,new Date(0),new Date(0));
  const latest=await storage.openDocuments('实验2','Lab 2-1','c');assert.equal(latest.length,5);assert.deepEqual(latest.map(d=>d.source),['// 6','// 5','// 4','// 3','// 2']);
  assert.deepEqual(await readdir(path.join(dir,'projects','实验2')),filesBefore);
  const oldest=await storage.importSource('实验2','Lab 2-1',versions[0].sourceFile!);assert.equal(oldest.documentId,versions[0].documentId);
  const check={fingerprint:'hash',passed:1,total:1,status:'passed' as const,checkedAt:'now'};await storage.recordCheck(oldest,check);
  const state=await storage.projectState('实验2','Lab 2-1','c');assert.equal(state.documents?.find(v=>v.id===oldest.documentId)?.check?.status,'passed');assert.equal(state.documents?.find(v=>v.id===versions[1].documentId)?.check,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy linked project sources migrate to copies without overwriting managed code',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-migration-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();await storage.createLab('实验2');await storage.createProblem('实验2','Lab 2-1','c');
  const file=path.join(dir,'old.c');await writeFile(file,'// linked');await storage.bindSource('实验2','Lab 2-1','c',file,'UTF-8');
  const docs=await storage.openDocuments('实验2','Lab 2-1','c');assert.equal(docs[0].source,'// linked');assert.notEqual(docs[0].sourceFile,file);
  assert.match(await readFile(storage.paths('实验2','Lab 2-1','c').source,'utf8'),/int main/);
  await storage.save({...docs[0],source:'// new'});assert.equal(await readFile(file,'utf8'),'// linked');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('UTF-8 BOM, GBK and UTF-16 source encodings round trip including Chinese text and atomic replacement',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-encoding-'));
 try{
  for(const encoding of ['UTF-8','UTF-8 BOM','GBK / CP936','UTF-16 LE','UTF-16 BE']){
   const file=path.join(dir,encoding.replace(/\W/g,'')+'.c'),source='// 中文\nint main(void){return 0;}\n';
   await writeSource(file,source,encoding);const decoded=decodeText(await readFile(file));assert.equal(decoded.text,source);assert.equal(decoded.encoding,encoding);
   await writeSource(file,source+'// 再保存\n',decoded.encoding);assert.equal(decodeText(await readFile(file)).text,source+'// 再保存\n');
  }
  const file=path.join(dir,'gbk.c');await writeSource(file,'中文','GBK / CP936');await assert.rejects(writeSource(file,'😀','GBK / CP936'));assert.equal(decodeText(await readFile(file)).text,'中文');
  assert.throws(()=>decodeText(Buffer.from([255,254,0])),/不完整/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cache leases exclude clearing, abort waiting compiles and recycle only compiler files at the configured bound',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-cache-test-'));
 try{
  const cache=new CompilerCache(path.join(dir,'cache'),8),other=new CompilerCache(cache.directory),source=path.join(dir,'source.c');await writeFile(source,'keep');
  const release=await cache.acquire();await writeFile(path.join(cache.directory,'cached'),Buffer.alloc(32));
  await assert.rejects(other.clear(),/另一个 LabPad/);const abort=new AbortController(),waiting=other.acquire(abort.signal);abort.abort();await assert.rejects(waiting);
  await cache.trim();assert.equal(await cache.size(),0);await release();
  await writeFile(path.join(cache.directory,'cached'),Buffer.alloc(64));assert.equal(await cache.clear(),64);assert.equal(await readFile(source,'utf8'),'keep');assert.equal(await cache.size(),0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('shortcut defaults and configuration validate duplicate and sequence prefix collisions',()=>{
 const defaults=defaultShortcuts();assert.equal(validateShortcuts(defaults),defaults);assert.deepEqual(defaults.run,['F9','Control+Enter']);
 const bad=defaultShortcuts();bad.save=['F9'];assert.throws(()=>validateShortcuts(bad),/重复/);
 const prefix=defaultShortcuts();prefix.run=['$mod+KeyK'];assert.throws(()=>validateShortcuts(prefix),/前缀/);
 const malformed=defaultShortcuts();malformed.run=['Control+'];assert.throws(()=>validateShortcuts(malformed),/格式/);
 const disabled=defaultShortcuts();disabled.run=[];assert.deepEqual(validateShortcuts(disabled).run,[]);
});
