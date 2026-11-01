import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {defaultConfig,defaultCompilerConfig,defaultStandards,defaultProblem,withDefaultStandard} from '../shared/defaults';
import {defaults,parse} from '../shared/lpmake';
import {workspaceTemplate} from '../shared/workspace';
import {resolve} from '../core/build/resolve';
import {Storage} from '../core/storage';
import {Compiler} from '../core/compiler';
import {fingerprint} from '../core/submission';
import {judge} from '../core/judge';
import type {Draft} from '../shared/types';
const runtime={toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')};
const standard=(args:string[])=>args.filter(arg=>arg.startsWith('-std=')).at(-1);
test('C17/C++20 defaults agree across profiles, project templates and no-inheritance fallbacks; explicit settings survive',async()=>{
 assert.deepEqual(defaultStandards,{c:'c17',cpp:'c++20'});
 for(const kind of ['zig','gcc','clang'] as const){const config=defaultCompilerConfig(kind);assert.equal(standard(config.cArgs),'-std=c17');assert.equal(standard(config.cppArgs),'-std=c++20');}
 assert.equal(standard(defaults.c),'-std=c17');assert.equal(standard(defaults.cpp),'-std=c++20');
 assert.equal(parse(workspaceTemplate('c')['LPMake.txt']).spec.standards.c,'c17');assert.equal(parse(workspaceTemplate('cpp')['LPMake.txt']).spec.standards.cpp,'c++20');
 assert.deepEqual(withDefaultStandard(['-ansi'],'cpp'),['-ansi']);
 const draft:Draft={source:'int main(){return 0;}',language:'cpp',problem:defaultProblem('standards','')},implicit={...defaultConfig().compiler,cppArgs:[]};
 assert.equal(fingerprint(draft,implicit,'compiler'),fingerprint(draft,{...implicit,cppArgs:['-std=c++20']},'compiler'));
 assert.notEqual(fingerprint(draft,implicit,'compiler'),fingerprint(draft,{...implicit,cppArgs:['-std=c++17']},'compiler'));

 const root=await mkdtemp(path.join(tmpdir(),'labpad-standards-'));
 try{
  await writeFile(path.join(root,'unit.c'),'int value(void){return 1;}');await writeFile(path.join(root,'main.cpp'),'int main(){return 0;}');
  for(const inherit of [true,false]){const plan=await resolve(parse('target("app")\nadd_files("*.c", "*.cpp")').spec,root,{c:[],cpp:[],link:[]},inherit);assert.equal(standard(plan.units.find(u=>u.language==='c')!.args),'-std=c17');assert.equal(standard(plan.units.find(u=>u.language==='cpp')!.args),'-std=c++20');}
  const explicit=await resolve(parse('target("app")\nset_standard("c11")\nset_standard("c++17")\nadd_files("*.c", "*.cpp")').spec,root);
  assert.equal(standard(explicit.units.find(u=>u.language==='c')!.args),'-std=c11');assert.equal(standard(explicit.units.find(u=>u.language==='cpp')!.args),'-std=c++17');
  const custom=await resolve(parse('target("app")\nadd_files("main.cpp")').spec,root,{c:[],cpp:['-std=c++17'],link:[]});assert.equal(standard(custom.units[0].args),'-std=c++17');
  const storage=new Storage(path.join(root,'data'));const config=await storage.init();assert.equal(standard(config.compiler.cppArgs),'-std=c++20');config.compiler.cppArgs=['-std=c++17','-O0'];await storage.saveConfig(config);assert.deepEqual((await new Storage(storage.root).init()).compiler.cppArgs,config.compiler.cppArgs);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real Zig/GCC execute C17 and C++20 single files and mixed projects, including C++20 span/concepts/consteval',async()=>{
 const compiler=new Compiler(runtime);
 const c='#include <stdio.h>\n#if __STDC_VERSION__ != 201710L\n#error C17_required\n#endif\nint main(void){printf("%ld",(long)__STDC_VERSION__);}\n';
 const cpp='#include <span>\n#include <cstdio>\nstatic_assert(__cplusplus==202002L);\ntemplate<class T> concept Item=sizeof(T)>0;\nconsteval int number(){return 2;}\nint main(){int a[]={number()};std::span<int> values(a);printf("%ld",(long)__cplusplus+(values[0]-2));}\n';
 function draft(source:string,language:'c'|'cpp',expected:string):Draft{const problem=defaultProblem('standards','');problem.testCases=[{id:'1',input:'',expectedOutput:expected}];return {source,language,problem};}
 try{
  for(const kind of ['zig','gcc'] as const){
   const config=defaultConfig().compiler;if(kind==='gcc')Object.assign(config,{mode:'custom',kind,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'});
   for(const [source,language,expected] of [[c,'c','201710'],[cpp,'cpp','202002']] as const){const result=await judge(compiler,draft(source,language,expected),config);assert.equal(result.cases[0]?.verdict,'AC',result.error||result.compilation?.stderr);}
   const mixed=draft(cpp,'cpp','12');mixed.file='main.cpp';mixed.workspace={inheritDefaults:false,files:{'LPMake.txt':'target("app")\nadd_files("*.c","*.cpp")','unit.c':'#if __STDC_VERSION__ != 201710L\n#error C17_required\n#endif\nint c_value(void){return 7;}','main.cpp':'#include <span>\n#include <cstdio>\nstatic_assert(__cplusplus==202002L);\nextern "C" int c_value(void);\nconsteval int base(){return 5;}\nint main(){int a[]={c_value(),base()};std::span<int> values(a);printf("%d",values[0]+values[1]);}'}};
   const result=await judge(compiler,mixed,config);assert.equal(result.cases[0]?.verdict,'AC',result.error||result.compilation?.stderr);
  }
 }finally{await compiler.dispose();}
});
