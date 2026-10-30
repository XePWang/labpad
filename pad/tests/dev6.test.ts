import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Storage,decodeText,writeSource} from '../core/storage';
import {defaultConfig,defaultProblem,defaultSource} from '../shared/defaults';
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
  const external=await storage.importSource('','',original);assert.notEqual(external.sourceFile,await (await import('node:fs/promises')).realpath(original));
  await storage.save({...external,source:'// managed edit'});assert.equal(await readFile(original,'utf8'),'// original');assert.equal(await readFile(external.sourceFile!,'utf8'),'// managed edit');
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

test('legacy scratch links become UTF-8 copies once, retain version IDs and leave GBK originals unchanged',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-import-upgrade-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();
  const original=path.join(dir,'legacy.c'),source='// 中文\nint main(void){return 0;}\n';
  await writeSource(original,source,'GBK / CP936');const originalBytes=await readFile(original);
  const meta={schemaVersion:1,labId:'',problems:{'':{language:'c',starters:{c:source},checks:{},sources:{},activeDocumentId:'legacy-c',documents:[{id:'legacy-c',file:'空项目.c',language:'c',encoding:'GBK / CP936',externalPath:original,starter:source}]}}};
  await writeFile(path.join(storage.root,'.labpad'),JSON.stringify(meta));
  const docs=await storage.openDocuments('','','c');assert.equal(docs[0].documentId,'legacy-c');assert.equal(docs[0].source,source);assert.notEqual(docs[0].sourceFile,original);assert.equal(path.dirname(docs[0].sourceFile!),storage.root);assert.equal(decodeText(await readFile(docs[0].sourceFile!)).encoding,'UTF-8');
  await storage.save({...docs[0],source:source+'// 😀\n'});assert.deepEqual(await readFile(original),originalBytes);
  const again=await storage.openDocuments('','','c');assert.equal(again.length,1);assert.equal(again[0].sourceFile,docs[0].sourceFile);assert.match(again[0].source,/😀/);assert.equal((await storage.projectState('','','c')).documents![0].externalPath,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('saving a legacy version directly adopts a managed file instead of writing to its external path',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-import-save-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();const original=path.join(dir,'outside.c');await writeFile(original,'// keep original');
  await writeFile(path.join(storage.root,'.labpad'),JSON.stringify({schemaVersion:1,labId:'',problems:{'':{language:'c',starters:{},checks:{},sources:{},documents:[{id:'old',file:'空项目.c',language:'c',encoding:'UTF-8',externalPath:original}]}}}));
  await storage.save({documentId:'old',source:'// edited copy',language:'c',problem:defaultProblem('','')});
  assert.equal(await readFile(original,'utf8'),'// keep original');const saved=await storage.load('','','c',true);assert.equal(saved.source,'// edited copy');assert.equal(path.dirname(saved.sourceFile!),storage.root);assert.equal((await storage.projectState('','','c')).documents![0].externalPath,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing legacy originals remain recoverable and are never recreated outside the data directory',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-import-missing-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();const missing=path.join(dir,'missing.c');
  await writeFile(path.join(storage.root,'.labpad'),JSON.stringify({schemaVersion:1,labId:'',problems:{'':{language:'c',starters:{},checks:{},sources:{},documents:[{id:'old',file:'空项目.c',language:'c',encoding:'UTF-8',externalPath:missing,starter:'// template'}]}}}));
  const docs=await storage.openDocuments('','','c');assert.match(docs[0].warning??'',/重新导入/);await storage.save({...docs[0],source:'// recovered copy'});
  await assert.rejects(readFile(missing),{code:'ENOENT'});assert.equal((await storage.load('','','c',true)).source,'// recovered copy');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('new sources reuse per-topic language templates, preserve edits and fall back only when no template exists',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-new-source-'));
 try{
  const storage=new Storage(path.join(dir,'data'));await storage.init();
  const c='// course C template\nint main(void){return 0;}\n',cpp='// course C++ template\nint main(){return 0;}\n';
  await storage.importProject({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',language:'c',source:c},{problemId:'Lab 2-2',language:'cpp',source:cpp},{problemId:'Lab 2-3',source:''}]});
  const first=(await storage.openDocuments('实验2','Lab 2-1','c'))[0];await storage.save({...first,source:'// edited original version'});
  const fresh=await storage.newVersion({...first,source:'// unsaved edit'},true);
  assert.equal(fresh.source,c);assert.notEqual(fresh.documentId,first.documentId);assert.notEqual(fresh.sourceFile,first.sourceFile);assert.equal(await readFile(fresh.sourceFile!,'utf8'),c);assert.equal(await readFile(first.sourceFile!,'utf8'),'// edited original version');
  const copy=await storage.newVersion({...fresh,source:'// explicit version copy'});assert.equal(copy.source,'// explicit version copy');
  const fallback=await storage.newVersion({...fresh,language:'cpp'},true);assert.equal(fallback.source,defaultSource('cpp'));
  const other=await storage.load('实验2','Lab 2-2','cpp',true);assert.equal((await storage.newVersion(other,true)).source,cpp);
  const empty=await storage.load('实验2','Lab 2-3','c',true);assert.equal((await storage.newVersion(empty,true)).source,'');
  const scratch=await storage.load('','','c');assert.equal((await storage.newVersion(scratch,true)).source,defaultSource('c'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
