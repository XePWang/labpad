import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Compiler} from '../core/compiler';import {CompiledProgram} from '../core/compiled-program';import {judge} from '../core/judge';
import {defaultConfig,defaultProblem} from '../shared/defaults';import {compilationFingerprint} from '../core/submission';import {diagnosticCounts} from '../shared/diagnostics';import {TerminalHistory} from '../shared/terminal-history';
test('retained builds run updated cases without recompiling and a failed replacement cannot expose the prior executable',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-compiled-')),compiler=new Compiler({toolchain:'',checkers:path.resolve('../.work/checkers/linux-x64'),workDirectory:root,cacheDirectory:path.join(root,'cache')}),session=new CompiledProgram(compiler);
 const config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'gcc',cppPath:'g++'},problem={...defaultProblem('P','Q'),testCases:[{id:'1',input:'',expectedOutput:'42'}]},draft={documentId:'version1',source:'#include <stdio.h>\nint main(void){puts("42");}\n',language:'c' as const,problem};
 let count=0;const compile=compiler.compile.bind(compiler);compiler.compile=async(...args)=>{count++;return compile(...args);};
 try{
  const key=compilationFingerprint(draft,config,'gcc'),built=await session.compile(key,draft,config);assert.equal(built.status,'success',built.stderr);
  const program=session.require(key);for(let i=0;i<3;i++){const result=await judge(compiler,{...draft,problem:{...problem,testCases:[{id:String(i),input:'',expectedOutput:'42'}]}},config,undefined,undefined,undefined,program);assert.equal(result.cases[0].verdict,'AC');assert.equal((await readdir(program.directory)).filter(n=>n.startsWith('tests-')).length,0);}
  assert.equal(count,1);assert.equal(compilationFingerprint({...draft,problem:{...problem,timeLimitMs:4000,testCases:[]}},config,'gcc'),key);
  const edited={...draft,source:'invalid C source'};assert.throws(()=>session.require(compilationFingerprint(edited,config,'gcc')),/编译/);
  const failure=await session.compile('broken',edited,config);assert.equal(failure.status,'CE');assert.throws(()=>session.require(key),/编译/);assert.equal(session.matches('broken'),false);
 }finally{await session.clear();await compiler.dispose();await rm(root,{recursive:true,force:true});}
});
test('diagnostic counters count primary GCC, Clang, linker and MSVC lines without excerpts or summaries',()=>{
 const text='x.c:1:2: warning: conversion\nx.c:2:4: error: missing semicolon\nx.h:9: fatal error: no file\nld.lld: error: undefined symbol\nerror: invalid option\nx.cpp(1,2): warning C4244: narrowing\n  7 | printf("warning: text");\n    | ^\n1 warning and 3 errors generated.\n';
 assert.deepEqual(diagnosticCounts('',text),{warnings:2,errors:4});assert.deepEqual(diagnosticCounts(''),{warnings:0,errors:0});
 assert.deepEqual(diagnosticCounts('C:\\folder name\\main.c:3:1: warning: unused variable\n'),{warnings:1,errors:0});
});
test('terminal history is UTF-8 byte bounded, evicts complete messages and resets within a session',()=>{
 const h=new TerminalHistory(10);h.append('1234');h.append('中文');assert.equal(h.sizeBytes,10);h.append('🙂');assert.deepEqual(h.entries,['🙂','中文']);assert.equal(h.sizeBytes,10);
 assert.equal(h.prev(),'🙂');assert.equal(h.prev(),'中文');assert.equal(h.next(),'🙂');assert.equal(h.next(),undefined);
 h.setLimit(5);assert.deepEqual(h.entries,['🙂']);h.append('a'.repeat(6));assert.deepEqual(h.entries,[]);h.append('ok');h.clear();assert.equal(h.sizeBytes,0);assert.equal(h.prev(),undefined);
});

import {nativeButtonOrder,windowsActions} from '../shared/dialog-actions';
import {LineBuffer} from '../vendor/xterm-readline/src/line';
test('dialog layouts preserve explicit cancel and primary semantics on all three platforms',()=>{
 assert.equal(windowsActions('Win32'),true);for(const platform of ['darwin','MacIntel','Linux x86_64'])assert.equal(windowsActions(platform),false);
 assert.deepEqual(nativeButtonOrder(3,2,'win32'),[0,1,2]);assert.deepEqual(nativeButtonOrder(3,2,'linux'),[2,1,0]);assert.deepEqual(nativeButtonOrder(3,2,'darwin'),[0,1,2]);
 for(const platform of ['win32','linux','darwin']as const)for(const cancel of [0,1,2]){const order=nativeButtonOrder(3,cancel,platform);assert.equal(new Set(order).size,3);assert.equal(order[order.indexOf(cancel)],cancel);}
});
test('terminal line editing moves and removes full Unicode graphemes',()=>{
 const line=new LineBuffer();line.insert('A🙂e\u0301');line.backspace(1);assert.equal(line.buf,'A🙂');line.moveBack(1);assert.equal(line.pos,1);line.delete(1);assert.equal(line.buf,'A');line.moveHome();line.insert('中文');line.moveEnd();assert.equal(line.buf,'中文A');
});

import {terminalCommand} from '../shared/terminal-keymap';
test('terminal shortcuts follow Mac and Windows/Linux conventions without taking reserved Mac keys',()=>{
 const event=(key:string,mod:Partial<KeyboardEvent>={})=>({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,...mod});
 for(const platform of ['win32','linux','darwin']){
  assert.equal(terminalCommand(event('c',{ctrlKey:true}),platform,false,true,true),'interrupt');
  assert.equal(terminalCommand(event('c',{ctrlKey:true}),platform,true,true,true),'copy');
  assert.equal(terminalCommand(event('c',{ctrlKey:true,shiftKey:true}),platform,false,true,true),'consume');
  assert.equal(terminalCommand(event('c',{ctrlKey:true,isComposing:true}),platform,false,true,true),undefined);
  assert.equal(terminalCommand(event('d',{ctrlKey:true}),platform,false,true,true),'eof');
 }
 assert.equal(terminalCommand(event('ArrowLeft',{altKey:true}),'darwin',false,false,true),'wordLeft');
 assert.equal(terminalCommand(event('ArrowLeft',{ctrlKey:true}),'linux',false,false,true),'wordLeft');
 assert.equal(terminalCommand(event('Backspace',{ctrlKey:true}),'win32',false,false,true),'deleteWordLeft');
 assert.equal(terminalCommand(event('ArrowRight',{metaKey:true}),'darwin',false,false,true),'end');
 assert.equal(terminalCommand(event('c',{metaKey:true}),'darwin',false,false,true),'consume');
 assert.equal(terminalCommand(event('c',{metaKey:true}),'darwin',true,false,false),'copy');
 assert.equal(terminalCommand(event('z',{ctrlKey:true}),'darwin',false,true,true),undefined);assert.equal(terminalCommand(event('z',{ctrlKey:true}),'win32',false,true,true),'eof');
 for(const key of ['h','q','m'])assert.equal(terminalCommand(event(key,{metaKey:true}),'darwin',false,false,true),undefined);
});
