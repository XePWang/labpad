import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {prepareBuildDirectory,cleanBuildDirectory} from '../core/artifacts';import {compileDraft} from '../core/build';
import {Compiler} from '../core/compiler';import {defaultConfig,defaultProblem} from '../shared/defaults';
test('managed build ownership rejects existing user directories and clean preserves user files',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-artifacts-')),dir=path.join(root,'build');
 try{
  await mkdir(dir);await writeFile(path.join(dir,'notes.txt'),'keep');
  await assert.rejects(prepareBuildDirectory(dir,'a',['program']),/不属于/);assert.equal(await readFile(path.join(dir,'notes.txt'),'utf8'),'keep');
  const owned=path.join(root,'owned');await prepareBuildDirectory(owned,'a',['program','obj/unit.o']);await mkdir(path.join(owned,'obj'));await writeFile(path.join(owned,'program'),'binary');await writeFile(path.join(owned,'obj/unit.o'),'object');await writeFile(path.join(owned,'obj/notes.txt'),'mine');
  await cleanBuildDirectory(owned,'a');await assert.rejects(stat(path.join(owned,'program')),{code:'ENOENT'});assert.equal(await readFile(path.join(owned,'obj/notes.txt'),'utf8'),'mine');
  await assert.rejects(prepareBuildDirectory(owned,'a',['obj/notes.txt']),/未管理文件/);
 }finally{await rm(root,{recursive:true,force:true});}
});
