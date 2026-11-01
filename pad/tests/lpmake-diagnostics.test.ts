import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {parse,ConfigError} from '../shared/lpmake';
import {resolve} from '../core/build/resolve';

test('LPMake diagnostics include file coordinates, the original source, a caret and English guidance',()=>{
 const text='target("app")\nset_language("cpp")\nadd_files("main.c")';
 assert.throws(()=>parse(text),(error:unknown)=>{
  assert.ok(error instanceof ConfigError);assert.equal(error.line,2);assert.equal(error.column,14);
  assert.match(error.message,/^LPMake\.txt:2:14: error: Unsupported language "cpp"\./);
  assert.ok(error.message.includes('  2 | set_language("cpp")'));
  assert.ok(error.message.includes('    |              ^~~~~'));
  assert.ok(error.message.includes('  hint: Use set_language("c") or set_language("c++").'));
  assert.ok(error.message.includes('  note: Omit set_language()'));assert.doesNotMatch(error.message,/[\u3400-\u9fff]/);return true;
 });
});
test('hint and note are independently optional, with no empty diagnostic sections',()=>{
 for(const hint of [undefined,'Fix the argument.'])for(const note of [undefined,'The default is debug.']){
  const error=new ConfigError('x',0,'Invalid value.',hint,note);
  assert.equal(error.message,'LPMake.txt:1:1: error: Invalid value.\n  1 | x\n    | ^'+(hint?'\n  hint: '+hint:'')+(note?'\n  note: '+note:''));
 }
});
test('CRLF source positions and wide-character/tab caret alignment remain correct',()=>{
 assert.throws(()=>parse('# config\r\nset_mode("fast")\r\ntarget("app")'),(error:unknown)=>{assert.ok(error instanceof ConfigError);assert.equal(error.line,2);assert.equal(error.column,10);assert.ok(error.message.includes('  2 | set_mode("fast")'));assert.ok(!error.message.includes('\r'));return true;});
 assert.throws(()=>parse('target("你好")\tunknown("x")'),(error:unknown)=>{assert.ok(error instanceof ConfigError);assert.equal(error.column,14);assert.ok(error.message.includes('    | '+' '.repeat(18)+'^~~~~~~'));return true;});
});
test('all parser failure families provide English, actionable source diagnostics',()=>{
 for(const source of [
  'target("app"', 'unknown("x")', 'target()', 'target("a", "b")', 'target("")',
  'target("a")\ntarget("b")', 'target("a")\nset_standard("c11")\nset_standard("c17")',
  'target("a")\nset_standard("c25")', 'target("a")\nset_optimize("debug")',
  'target("a")\nadd_defines(" BAD")', 'target("a")\nadd_files("../main.c")',
  'target("a")\nadd_cflags("\\u0000")', 'add_files("main.c")'
 ]){
  assert.throws(()=>parse(source),(error:unknown)=>{assert.ok(error instanceof ConfigError);assert.match(error.message,/^LPMake\.txt:\d+:\d+: error: /);assert.match(error.message,/\n  \d+ \| /);assert.ok(error.message.includes('^'));assert.ok(error.message.includes('  hint: '));assert.doesNotMatch(error.message,/[\u3400-\u9fff]/);return true;});
 }
});
test('file resolution failures point back to their LPMake declaration',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-diagnostic-'));
 try{
  await writeFile(path.join(root,'main.c'),'int main(void){return 0;}');
  for(const [source,reason,command] of [
   ['target("app")','Missing add_files()','target'],
   ['target("app")\nadd_files("missing.c")','Source file "missing.c" does not exist.','add_files'],
   ['target("app")\nadd_files("src/*.c")','No source files remain','add_files'],
   ['target("app")\nadd_files("main.c")\nadd_includedirs("missing")','Directory "missing" does not exist','add_includedirs'],
   ['target("app")\nadd_files("main.c")\nadd_linkdirs("missing")','Directory "missing" does not exist','add_linkdirs']
  ]){
   await assert.rejects(resolve(parse(source).spec,root),(error:unknown)=>{assert.ok(error instanceof ConfigError);assert.ok(error.message.includes(reason));assert.ok(error.message.includes(command+'('));assert.ok(error.message.includes('  hint: '));assert.doesNotMatch(error.message,/[\u3400-\u9fff]/);return true;});
  }
  await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/api.h'),'#pragma once');
  await assert.rejects(resolve(parse('target("app")\nadd_files("src/api.h")').spec,root),/Unsupported source extension/);
 }finally{await rm(root,{recursive:true,force:true});}
});
