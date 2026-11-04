import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Storage} from '../core/storage';import {defaultProblem,defaultConfig} from '../shared/defaults';
import {Compiler} from '../core/compiler';import {compileDraft} from '../core/build';import {runProcess} from '../core/process';
test('file tree moves preserve problem/version association and copies belong to the selected problem',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-file-versions-'));
 try{
  const storage=new Storage(root);await storage.init();await storage.createLab('Lab');await storage.createProblem('Lab','one','c');await storage.createProblem('Lab','two','c');
  const [one]=await storage.openDocuments('Lab','one','c');await storage.save({...one,source:'int main(void){return 3;}\n'});
  await storage.operateFiles('Lab','one',{action:'newFolder',paths:['src']});
  await storage.operateFiles('Lab','one',{action:'move',paths:[one.file!],destination:'src'});
  const moved=await storage.openFile('Lab','two','src/'+one.file!);assert.equal(moved.problem.problemId,'one');assert.equal(moved.documentId,one.documentId);
  assert.match(moved.source,/return 3/);
  await storage.operateFiles('Lab','two',{action:'copy',paths:['src/'+one.file!],destination:''});
  const copied=await storage.openFile('Lab','one',one.file!);assert.equal(copied.problem.problemId,'two');assert.notEqual(copied.documentId,one.documentId);
  await storage.operateFiles('Lab','one',{action:'rename',paths:['src/'+one.file!],destination:'src/value.cpp'});
  assert.equal((await storage.openFile('Lab','two','src/value.cpp')).language,'cpp');
  await storage.operateFiles('Lab','one',{action:'rename',paths:['src/value.cpp'],destination:'src/notes.txt'});
  assert.equal((await storage.openFile('Lab','one','src/notes.txt')).auxiliary,true);
  assert.ok(!(await storage.projectState('Lab','one','c')).documents!.some(d=>d.id===one.documentId));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('single-file GUI compilation stays temporary and never links other source versions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-single-files-')),compiler=new Compiler({toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')});
 try{
  const source='#include <stdio.h>\n#include "api.h"\nint main(void){printf("%d\\n",VALUE);}\n',config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
  const prepared=await compileDraft(compiler,{file:'main.c',source,language:'c',problem:defaultProblem('Lab','one'),sourceFiles:{files:{'main.c':source,'api.h':'#define VALUE 7\n','other.cpp':'#error this version must not be compiled\n'}}},config);
  try{
   assert.equal(prepared.compilation.status,'success',prepared.compilation.stderr);assert.ok(!prepared.buildDirectory);
   const result=await runProcess(prepared.executable,[],{cwd:prepared.directory,timeLimitMs:1000,outputLimitBytes:10000});assert.equal(result.stdout.toString().trim(),'7');
  }finally{await prepared.cleanup();}
 }finally{await compiler.dispose();await rm(root,{recursive:true,force:true});}
});
