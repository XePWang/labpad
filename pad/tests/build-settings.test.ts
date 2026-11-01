import {zipSync,strToU8} from 'fflate';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {parameterErrors,argumentSummary,parameterAdvice,relativePathAdvice,argumentTokens} from '../shared/parameters';
import {defaultConfig,defaultProblem} from '../shared/defaults';import {parse} from '../shared/lpmake';import {effectiveCompiler,workspacePackage} from '../shared/workspace';
import {draftPlan,previewPlan,buildOptionsSignature} from '../core/build/plan';import {resolve} from '../core/build/resolve';import {fingerprint,prepareWorkspaceProject} from '../core/submission';import {Storage} from '../core/storage';import {Compiler} from '../core/compiler';import {judge} from '../core/judge';import {runGrade} from '../cli/grade';import type {Draft} from '../shared/types';
const runtime={toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')};
async function temp(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'labpad-build-settings-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
const project=(inherit=false):Draft=>({file:'src/main.c',source:'int main(void){return 0;}',language:'c',problem:defaultProblem('配置测试',''),workspace:{inheritDefaults:inherit,files:{'LPMake.txt':'target("app")\nadd_files("src/*.c","src/*.cpp")\n','src/main.c':'int main(void){return 0;}'}}});
test('parameter validation separates option values, explicit build controls and legitimate compiler options',()=>{
 for(const arg of ['-c','-S','-E','-M','-MM','--compile','--assemble','--preprocess','--dependencies','--user-dependencies','--output=file','--language=c','-xc','-xc++','-xnone'])assert.equal(parameterErrors([arg],'c')[0]?.severity,'error',arg);
 for(const args of [['-o','output'],['--output','out'],['-x','c++']])assert.equal(parameterErrors(args,'c')[0]?.severity,'error');
 for(const args of [['-MD','-MMD'],['-object-file-name=debug.o'],['-object-file-name','debug.o'],['-object-file-name','-o'],['-DNOTE=-o'],['-D','NOTE=-x'],['-I','-o'],['-DMSG=hello world'],['-ofoo'],['-unknown-experimental-flag']])assert.deepEqual(parameterErrors(args,'c'),[],JSON.stringify(args));
 for(const flag of ['-I','-L','-include','-isystem','-D','-U','--std','-MF','-Xclang'])assert.match(parameterErrors([flag],'c')[0]?.message??'',/缺少参数值/,flag);
 assert.equal(argumentTokens(['-include','some file.h','-DMSG=hello world']).length,2);
});
test('effective overrides, macro disablement and path advice follow argument boundaries and order',()=>{
 assert.deepEqual(argumentSummary(['-std=c17','--std','c11','-O2','-g','-DNDEBUG','-O0','-g0','-U','NDEBUG']),{standard:'c11',optimization:'-O0',symbols:'-g0',ndebug:'未定义'});
 const relative=relativePathAdvice(['-Irelative path','-L','libs','-include','config.h'],'c');assert.equal(relative.length,3);
 assert.equal(relativePathAdvice(['-IC:\\SDK\\include','-L\\\\server\\share','-include','/tmp/config.h'],'c').length,0);
 assert.equal(relativePathAdvice(['-include config.h'],'c').length,0,'do not split one process argument on spaces');
});
test('pairing advice uses categories, runtime libraries and explicit disabling instead of exact-string equality',()=>{
 const inspect=(compile:string[],link:string[],kind='gcc')=>parameterAdvice([{language:'c',args:compile}],link,kind);
 assert.equal(inspect(['--coverage'],['-lgcov']).length,0);
 assert.equal(inspect(['-fsanitize=address,undefined'],['-fsanitize=undefined','-fsanitize=address']).length,0);
 assert.equal(inspect(['-fsanitize=address','-fno-sanitize=address'],[]).length,0);
 assert.equal(inspect(['-fopenmp','-fno-openmp'],[]).length,0);
 assert.equal(inspect(['--coverage','-fno-profile-arcs'],[]).length,0);
 assert.equal(inspect(['-flto','-fno-lto'],[]).length,0);
 assert.ok(inspect(['-flto=auto'],[]).every(i=>i.severity==='info'));
 assert.match(inspect(['-flto'],['-fno-lto'])[0].message,/显式关闭/);
 assert.match(inspect(['-pthread'],[])[0].message,/-pthread/);
 assert.equal(inspect(['-pthread'],['-pthread']).length,0);
 assert.equal(inspect(['-fsanitize=undefined','-fsanitize-trap=all'],[])[0].severity,'info');
});
test('project preview and filesystem resolution share source matching, defaults, flags and English source diagnostics',async()=>temp(async root=>{
 const draft=project(true);draft.workspace!.files['src/helper.cpp']='int helper(){return 1;}';
 draft.workspace!.files['LPMake.txt']='target("app")\nset_standard("c17")\nadd_files("src/*.{c,cpp}")\nadd_cflags("-std=c11","-O1")\n';
 for(const [file,text]of Object.entries(draft.workspace!.files)){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),text);}
 const config=defaultConfig().compiler,logical=draftPlan(draft,config),physical=await resolve(parse(draft.workspace!.files['LPMake.txt']).spec,root,{c:config.cArgs,cpp:config.cppArgs,link:config.linkArgs},true);
 assert.deepEqual(physical.units,logical.units);assert.deepEqual(physical.linkArgs,logical.linkArgs);
 const preview=previewPlan(draft,config);assert.equal(preview.units.find(u=>u.language==='c')!.summary.standard,'c11');assert.ok(preview.issues.some(i=>i.field==='cStandard'));assert.ok(preview.issues.some(i=>i.field==='optimize'));
 draft.workspace!.files['LPMake.txt']='target("app")\nadd_files("src/*.c")\nadd_cflags("-o")\n';
 assert.throws(()=>draftPlan(draft,config),/LPMake\.txt:3:12: error: Output selection/);
}));
test('fingerprints exclude ignored defaults and unused languages but retain actual inputs, tests and used toolchains',()=>{
 const config=defaultConfig().compiler,draft=project(false),unused={...config,cArgs:['-E'],cppArgs:['-S'],linkArgs:['--output=unused']};
 assert.equal(fingerprint(draft,config,'c-id'),fingerprint(draft,unused,'c-id'));
 assert.equal(fingerprint(draft,config,'c-id'),fingerprint(draft,{...config,cppPath:'/unused/cxx'},'c-id'));
 assert.notEqual(fingerprint(draft,config,'c-id'),fingerprint(draft,config,'changed-id'));
 const edited=structuredClone(draft);edited.workspace!.files['src/main.c']='int main(void){return 2;}';assert.notEqual(fingerprint(draft,config,'c-id'),fingerprint(edited,config,'c-id'));
 const changedTests=structuredClone(draft);changedTests.problem.testCases=[{id:'1',input:'',expectedOutput:'x'}];assert.notEqual(fingerprint(draft,config,'c-id'),fingerprint(changedTests,config,'c-id'));
 const single:Draft={source:'int main(void){return 0;}',language:'c',problem:defaultProblem('题集','P')};
 assert.equal(fingerprint(single,config,'id'),fingerprint(single,{...config,cppArgs:['-std=c++11']},'id'));
 const custom={inheritDefaults:false,cArgs:['-std=c11'],cppArgs:[],linkArgs:[]};
 assert.equal(fingerprint(single,effectiveCompiler(config,custom),'id'),fingerprint(single,effectiveCompiler({...config,cArgs:['-O3'],cppArgs:['-E']},custom),'id'));
});
test('workspace saves build text and inheritance together; ordinary saves leave build options alone; export preserves overlays',async()=>temp(async root=>{
 const storage=new Storage(root);await storage.init();const current=await storage.workspace.create('工程'),make=await storage.workspace.open('工程','LPMake.txt');
 await storage.workspace.save({...current,source:'// updated ordinary file',workspaceBuild:{inheritDefaults:false}});
 assert.equal((await storage.workspace.read('工程')).inheritDefaults,true);
 const changed={...make,source:make.source+'# changed\n',workspaceBuild:{inheritDefaults:false}};await storage.workspace.save(changed);
 assert.equal((await storage.workspace.read('工程')).inheritDefaults,false);assert.equal((await storage.workspace.open('工程','LPMake.txt')).source,changed.source);
 const overlay={...current,source:'// unsaved overlay',workspaceBuild:{inheritDefaults:true}};
 const snapshot=await storage.workspace.snapshot('工程',[overlay]);assert.equal(snapshot.inheritDefaults,true);assert.equal(snapshot.files['src/main.c'],overlay.source);
 const exported=await prepareWorkspaceProject(storage,{...current,workspaceBuild:{inheritDefaults:true}},defaultConfig(),[overlay],true);
 assert.equal(exported.files.find(f=>f.name==='src/main.c')?.source,overlay.source);
 assert.equal(JSON.parse(exported.files.find(f=>f.name==='labpad.project.json')!.source).build.inheritDefaults,true);
}));
test('failed metadata write rolls back source and inheritance, keeps the queue usable and preserves exact original bytes',async()=>temp(async root=>{
 const storage=new Storage(root);await storage.init();await storage.workspace.create('工程');const store=storage.workspace,make=await store.open('工程','LPMake.txt');
 const metadata=await readFile(store.metadata('工程')),source=await readFile(make.sourceFile!),original=(store as any).write;
 (store as any).write=async()=>{throw Error('simulated metadata failure');};
 await assert.rejects(store.save({...make,source:'changed',workspaceBuild:{inheritDefaults:false}}),/simulated metadata failure/);
 assert.deepEqual(await readFile(make.sourceFile!),source);assert.deepEqual(await readFile(store.metadata('工程')),metadata);
 (store as any).write=original;
 await store.save({...make,workspaceBuild:{inheritDefaults:false}});assert.equal((await store.read('工程')).inheritDefaults,false);
}));
test('real GCC workspace reuses its build directory after code/tests/ignored parameters change and uses only the C identity',async()=>temp(async root=>{
 const compiler=new Compiler({...runtime,cacheDirectory:path.join(root,'cache'),workDirectory:path.join(root,'run')}),config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/unavailable-unused-cxx',cppArgs:['-E']},draft=project(false);
 draft.workspace!.files['src/main.c']='#include <stdio.h>\nint main(void){puts("one");}';draft.problem.testCases=[{id:'1',input:'',expectedOutput:'one'}];
 try{
  const id=await compiler.identityFor(draft,config);assert.equal(id,await compiler.identity(config,'c'));
  let result=await judge(compiler,draft,config);assert.equal(result.cases[0]?.verdict,'AC',result.error||result.compilation?.stderr);
  draft.workspace!.files['src/main.c']='#include <stdio.h>\nint main(void){puts("two");}';draft.problem.testCases[0].expectedOutput='two';draft.workspace!.files['src/helper.c']='int helper(void){return 3;}';
  result=await judge(compiler,draft,{...config,cArgs:['-E'],linkArgs:['--output=ignored']});assert.equal(result.cases[0]?.verdict,'AC',result.error||result.compilation?.stderr);
  assert.equal((await readdir(path.join(root,'cache/projects'))).length,1);
 }finally{await compiler.dispose();}
}));
test('CLI partial regrade ignores unused C++ defaults yet rejects changes to the C toolchain parameters actually used',async()=>temp(async root=>{
 await mkdir(path.join(root,'submit'));await writeFile(path.join(root,'roster.csv'),'序号,学号,姓名\n1,1001,示例同学\n');
 await writeFile(path.join(root,'submit/1001_P.c'),'#include <stdio.h>\nint main(void){puts("ok");}');
 await writeFile(path.join(root,'project.json'),JSON.stringify({schemaVersion:1,kind:'labpad.project',labId:'示例实验',problems:[{problemId:'P',testCases:[{id:'1',input:'',expectedOutput:'ok'}]}]}));
 const config={schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{P:1},compiler:{kind:'gcc',cppArgs:['-E']},isolation:'none'};
 const save=()=>writeFile(path.join(root,'grade.json'),JSON.stringify(config));await save();
 const first=await runGrade(root,runtime);assert.equal(first.summary[0]['得分100'],'100.00');
 config.compiler.cppArgs=['-S'];await save();const second=await runGrade(root,runtime,{studentId:'1001'});assert.equal(second.summary[0]['得分100'],'100.00');
 (config.compiler as any).cArgs=['-std=c11','-O0'];await save();await assert.rejects(runGrade(root,runtime,{studentId:'1001'}),/已使用的编译器或参数已变化/);
}));

test('CLI workspace regrade with inheritance off excludes all machine argument arrays and keeps complete submissions',async()=>temp(async root=>{
 await mkdir(path.join(root,'submit'));await writeFile(path.join(root,'roster.csv'),'序号,学号,姓名\n1,1001,示例同学\n');
 const files={'LPMake.txt':'target("app")\nadd_files("*.c")\n','main.c':'#include <stdio.h>\nint main(void){puts("ok");}'};
 await writeFile(path.join(root,'submit/1001.zip'),zipSync(Object.fromEntries(Object.entries(files).map(([p,s])=>['project/'+p,strToU8(s)]))));
 const problem=defaultProblem('示例工程','');problem.testCases=[{id:'1',input:'',expectedOutput:'ok'}];
 await writeFile(path.join(root,'project.json'),JSON.stringify(workspacePackage('示例工程',{files,inheritDefaults:false},problem)));
 const config={schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{main:1},compiler:{kind:'gcc',cArgs:['-E'],cppArgs:['-S'],linkArgs:['--output=unused']},isolation:'none'};
 const save=()=>writeFile(path.join(root,'grade.json'),JSON.stringify(config));await save();
 const first=await runGrade(root,runtime);assert.equal(first.summary[0]['得分100'],'100.00');
 config.compiler.cArgs=['-S'];config.compiler.cppArgs=['-E'];config.compiler.linkArgs=['-o','unused'];await save();
 const second=await runGrade(root,runtime,{studentId:'1001'});assert.equal(second.summary[0]['得分100'],'100.00');assert.equal(first.summary[0]['main_SHA256'],second.summary[0]['main_SHA256']);
}));
