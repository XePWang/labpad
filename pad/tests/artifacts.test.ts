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
test('GUI project builds stay temporary while only explicit command builds produce local build artifacts',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-build-locations-')),compiler=new Compiler({toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')});
 const draft={source:'',language:'c' as const,problem:defaultProblem('Locations',''),workspace:{files:{'LPMake.txt':'target("hello")\nadd_files("main.c")\n','main.c':'int main(void){return 0;}\n'}}},config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
 try{
  const gui=await compileDraft(compiler,draft,config);try{assert.equal(gui.compilation.status,'success',gui.compilation.stderr);await assert.rejects(stat(path.join(root,'build')),{code:'ENOENT'});assert.ok(!gui.executable.startsWith(root));}finally{await gui.cleanup();}
  const location={directory:path.join(root,'build'),cwd:root,owner:'lpmake:LPMake.txt'},command=await compileDraft(compiler,draft,config,undefined,location);
  try{assert.equal(command.compilation.status,'success',command.compilation.stderr);assert.equal(command.executable,path.join(root,'build','hello'));assert.ok((await stat(command.executable)).isFile());await writeFile(path.join(root,'build/snapshot/notes.txt'),'user note');}finally{await command.cleanup();}
  const again=await compileDraft(compiler,draft,config,undefined,location);try{assert.equal(again.compilation.status,'success',again.compilation.stderr);assert.equal(await readFile(path.join(root,'build/snapshot/notes.txt'),'utf8'),'user note');}finally{await again.cleanup();}
  await cleanBuildDirectory(location.directory,location.owner);assert.equal(await readFile(path.join(root,'build/snapshot/notes.txt'),'utf8'),'user note');
 }finally{await compiler.dispose();await rm(root,{recursive:true,force:true});}
});
