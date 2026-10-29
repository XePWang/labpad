import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compilerEnvironment,compilerSearchDirectories,detectCompilers} from '../core/toolchains';
import {defaultCompilerConfig,defaultProblem} from '../shared/defaults';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';

test('common compiler locations cover PATH, CodeBlocks, MSYS2, Scoop, Homebrew and versioned LLVM',()=>{
 const windows=compilerSearchDirectories('win32',{Path:'"C:\\Tools\\bin";C:\\Tools\\bin',SystemDrive:'C:',ProgramFiles:'C:\\Program Files','ProgramFiles(x86)':'C:\\Program Files (x86)',LOCALAPPDATA:'C:\\Users\\Example\\AppData\\Local'},'C:\\Users\\Example');
 for(const expected of ['C:\\Tools\\bin','C:\\Program Files\\CodeBlocks\\MinGW\\bin','C:\\msys64\\ucrt64\\bin','C:\\msys64\\clang64\\bin','C:\\Users\\Example\\scoop\\apps\\gcc\\current\\bin'])assert.ok(windows.includes(expected),expected);
 assert.equal(windows.filter(p=>p==='C:\\Tools\\bin').length,1);
 assert.ok(compilerSearchDirectories('darwin',{PATH:'/custom/bin'},'/Users/Example').includes('/opt/homebrew/opt/llvm/bin'));
 assert.ok(compilerSearchDirectories('linux',{PATH:'/custom/bin'},'/home/example').includes('/usr/lib/llvm-23/bin'));
});
test('compiler profiles reset defaults, omit libm for MSVC targets and do not share mutable arrays',()=>{
 const gcc=defaultCompilerConfig('gcc'),clang=defaultCompilerConfig('clang',true),zig=defaultCompilerConfig('zig');
 assert.deepEqual(gcc.cArgs,['-std=c17','-O2','-Wall','-Wextra']);assert.deepEqual(gcc.cppArgs,['-std=c++17','-O2','-Wall','-Wextra']);
 assert.deepEqual(gcc.linkArgs,['-lm']);assert.deepEqual(clang.linkArgs,[]);assert.equal(zig.kind,'zig');
 gcc.cArgs.push('-custom');assert.ok(!zig.cArgs.includes('-custom'));
});
test('custom compiler binaries are on child PATH without changing the parent environment',()=>{
 const compiler={...defaultCompilerConfig('gcc'),mode:'custom' as const,cPath:'/tools/c/bin/gcc',cppPath:'/tools/cpp/bin/g++'};
 const base={Path:'/system/bin',OTHER:'unchanged'},env=compilerEnvironment(base,compiler);
 assert.equal(env.Path,['/tools/c/bin','/tools/cpp/bin','/system/bin'].join(path.delimiter));assert.equal(env.OTHER,'unchanged');assert.equal(base.Path,'/system/bin');assert.equal(env.PATH,undefined);
});
test('discovery recognizes actual versions, pairs C++, deduplicates aliases and ignores broken executables',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-detect-'));
 async function executable(name:string,body:string){const file=path.join(dir,name);await writeFile(file,'#!/bin/sh\n'+body+'\n');await chmod(file,0o755);return file;}
 try{
  await executable('gcc','case "$1" in --version) echo "gcc (fixture) 13.2.0";; -dumpmachine) echo x86_64-linux-gnu;; esac');
  await executable('g++','echo "g++ (fixture) 13.2.0"');await symlink(path.join(dir,'gcc'),path.join(dir,'gcc-13'));
  await executable('clang','printf "clang version 18.0.0\\nTarget: x86_64-pc-windows-msvc\\n"');
  await executable('clang++','echo "clang version 18.0.0"');
  await executable('cc','echo "unsupported command"');await executable('zig','exit 1');await mkdir(path.join(dir,'gcc-99'));
  const found=await detectCompilers({cwd:dir,directories:[dir,dir]});
  assert.equal(found.length,2);assert.deepEqual(found.map(c=>c.name),['Clang','GCC']);
  assert.equal(found[0].compiler.kind,'clang');assert.deepEqual(found[0].compiler.linkArgs,[]);assert.equal(found[0].compiler.cppPath,path.join(dir,'clang++'));
  assert.equal(found[1].compiler.cppPath,path.join(dir,'g++'));assert.deepEqual(found[1].compiler.linkArgs,['-lm']);
  assert.deepEqual(await detectCompilers({cwd:dir,directories:[path.join(dir,'missing')]}),[]);
  assert.deepEqual(await detectCompilers({cwd:dir,directories:[dir],exclude:[dir]}),[]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('discovery supports C-only installs and times out a hanging candidate',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'labpad-detect-c-'));
 try{
  for(const [name,body] of [['gcc','case "$1" in --version) echo "gcc (fixture) 13.0.0";; -dumpmachine) echo x86_64-linux-gnu;; esac'],['zig','sleep 30']]){
   const file=path.join(dir,name);await writeFile(file,'#!/bin/sh\n'+body+'\n');await chmod(file,0o755);
  }
  const started=Date.now(),found=await detectCompilers({cwd:dir,directories:[dir]});
  assert.equal(found.length,1);assert.equal(found[0].compiler.cppPath,'');assert.ok(Date.now()-started<10000);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a real discovered GCC profile compiles and judges both C and C++',async()=>{
 const root=path.resolve('..'),compiler=new Compiler({toolchain:path.join(root,'.work/toolchains/linux-x64'),checkers:path.join(root,'.work/checkers/linux-x64')});
 try{
  const found=await detectCompilers({cwd:await compiler.session,directories:['/usr/bin']});
  const gcc=found.find(c=>c.compiler.kind==='gcc'&&c.compiler.cppPath);assert.ok(gcc);
  const problem=defaultProblem('Lab 1','Lab 1-1');problem.testCases=[{id:'1',input:'',expectedOutput:'42'}];
  const c=await judge(compiler,{source:'#include <stdio.h>\nint main(void){printf("42");}',language:'c',problem},gcc.compiler);
  assert.equal(c.cases[0]?.verdict,'AC',c.error||c.compilation?.stderr);
  const cpp=await judge(compiler,{source:'#include <iostream>\nint main(){std::cout<<42;}',language:'cpp',problem},gcc.compiler);
  assert.equal(cpp.cases[0]?.verdict,'AC',cpp.error||cpp.compilation?.stderr);
 }finally{await compiler.dispose();}
});
