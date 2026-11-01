import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {zipSync,strToU8,unzipSync} from 'fflate';
import {parse,editList,editSingle,parser} from '../shared/lpmake';import {resolve} from '../core/build/resolve';import {Compiler} from '../core/compiler';import {compileDraft} from '../core/build';import {judge} from '../core/judge';import {Storage} from '../core/storage';import {defaultConfig,defaultProblem} from '../shared/defaults';import {workspaceTemplate,workspacePackage,parseWorkspacePackage,workspacePath,uniquePaths} from '../shared/workspace';import {readProjectArchive} from '../core/project-archive';import {prepareWorkspaceProject,prepareProject,submissionZip,fingerprint} from '../core/submission';import {runGrade} from '../cli/grade';
const runtime={toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')};
async function temp(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'labpad-dev8-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
function comments(text:string){const result:string[]=[],c=parser.parse(text).cursor();do{if(c.name==='Comment')result.push(text.slice(c.from,c.to));}while(c.next());return result;}
const files={'LPMake.txt':'# project\ntarget("calc")\nset_standard("c11")\nset_standard("c++20")\nadd_includedirs(".","include")\nadd_files("src/*.c","common/*.cpp")\n','include/api.h':'#ifdef __cplusplus\nextern "C" {\n#endif\nint value(void);\n#ifdef __cplusplus\n}\n#endif\n','src/main.c':'#include <stdio.h>\n#include "api.h"\nint main(void){int n;scanf("%d",&n);printf("%d\\n",n+value());}\n','common/value.cpp':'#include <string>\n#include "api.h"\nextern "C" int value(void){return (int)std::string("abc").size();}\n'};
test('LPMake list edits retain comments, repeated calls, trailing commas and undo-size text changes',()=>{
 const text='target("a") # root\nadd_defines("A", # first\n "B", # second\n) # end\nadd_defines("C") # third\nset_standard("c11")\nset_standard("c++20")\n';
 for(const values of [[],['X'],['X','Y'],['A','B','C','D']]){
  const next=editList(text,'add_defines',values);assert.deepEqual(parse(next).spec.defines,values);assert.deepEqual(comments(next),comments(text));
 }
 const inserted=editList(text,'add_cflags',['-Wall']);assert.deepEqual(parse(inserted).spec.cflags,['-Wall']);assert.deepEqual(comments(inserted),comments(text));
 const standard=editSingle(text,'set_standard','c17','c');assert.deepEqual(parse(standard).spec.standards,{c:'c17',cpp:'c++20'});
 assert.throws(()=>editSingle(text,'target',undefined));assert.throws(()=>parse('target("a")\nadd_defines(" BAD")'),/LPMake\.txt:2:13: error:/);
});
test('workspace paths reject escapes and cross-platform conflicts',()=>{
 for(const p of ['../x.c','C:/x.c','/a.c','src\\x.c','src/NUL.c','.git/config','src/a:bad.c'])assert.throws(()=>workspacePath(p));
 assert.throws(()=>uniquePaths(['src/A.c','src/a.c']),/冲突/);assert.throws(()=>uniquePaths(['a','a/b.c']),/冲突/);assert.throws(()=>uniquePaths(['Src/a.c','src/b.c']),/冲突/);
});
test('workspace files stay separate from legacy drafts; rename, collision, view and snapshots preserve unsaved source',async()=>temp(async root=>{
 const storage=new Storage(root);await storage.init();const first=await storage.workspace.create('工程','c');
 assert.equal(first.file,'src/main.c');assert.equal((await storage.projects())[0].mode,'project');
 await storage.workspace.mutate('工程','newFile','include/api.h',undefined,'int api(void);\n');
 await assert.rejects(storage.workspace.mutate('工程','newFile','include/API.h'),/同名/);await assert.rejects(storage.workspace.mutate('工程','newFile','Include/new.h'),/大小写/);
 await storage.workspace.mutate('工程','rename','include/api.h','include/stack.h');
 await assert.rejects(storage.workspace.mutate('工程','delete','LPMake.txt'),/不能/);
 await storage.workspace.update('工程',{openFiles:['LPMake.txt','src/main.c'],activeFile:'LPMake.txt',expanded:['src'],sidebarCollapsed:true});
 assert.equal((await storage.workspace.documents('工程')).length,2);
 const snapshot=await storage.workspace.snapshot('工程',[{...first,source:'// unsaved'}]);assert.equal(snapshot.files['src/main.c'],'// unsaved');assert.notEqual((await storage.workspace.open('工程','src/main.c')).source,'// unsaved');
 await storage.workspace.save({...first,source:'// saved'});assert.equal((await storage.workspace.open('工程','src/main.c')).source,'// saved');
 await storage.createLab('旧项目');await storage.createProblem('旧项目','Lab 1','c');assert.equal((await storage.load('旧项目','Lab 1','c')).source.includes('main'),true);
}));
test('production pipeline builds mixed snapshots on GCC and Zig, relinks changed headers and blocks stale executable',async()=>temp(async root=>{
 const compiler=new Compiler({...runtime,cacheDirectory:path.join(root,'cache'),workDirectory:path.join(root,'runtime')});
 const base=defaultConfig().compiler,configs=[{...base,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'},base];
 const problem={...defaultProblem('工程',''),testCases:[{id:'1',input:'4\n',expectedOutput:'7\n'}]},draft={source:'',language:'c' as const,problem,workspace:{files,inheritDefaults:true}};
 try{
  for(const config of configs){const result=await judge(compiler,draft,config);assert.equal(result.status,'completed',result.error);assert.equal(result.compilation?.status,'success',result.compilation?.stderr);assert.equal(result.cases[0]?.verdict,'AC',JSON.stringify(result));assert.equal(result.compilation?.commands?.length,3);}
  const changed={...draft,workspace:{...draft.workspace,files:{...files,'common/value.cpp':files['common/value.cpp'].replace('"abc"','"abcde"')}}};
  assert.notEqual(fingerprint(draft,base,'id'),fingerprint(changed,base,'id'));const next=await judge(compiler,{...changed,problem:{...problem,testCases:[{id:'1',input:'4\n',expectedOutput:'9\n'}]}},configs[0]);assert.equal(next.cases[0].verdict,'AC');
  const bad=await compileDraft(compiler,{...draft,workspace:{...draft.workspace,files:{...files,'src/new.c':'#error intentional\n'}}},configs[0]);try{assert.equal(bad.compilation.status,'CE');assert.equal(bad.compilation.commands?.length,3);await assert.rejects(stat(bad.executable));}finally{await bad.cleanup();}
 }finally{await compiler.dispose();}
}));
test('workspace ZIP roundtrip preserves LPMake, headers, resources and test rules without config-only recovery',async()=>temp(async root=>{
 const storage=new Storage(path.join(root,'data'));await storage.init();
 const problem={...defaultProblem('工程',''),testCases:[{id:'1',input:'4',expectedOutput:'7'}]},pkg=workspacePackage('工程',{files:{...files,'data/input.txt':'hello'},inheritDefaults:false},problem);
 await storage.workspace.create('工程','c',pkg);const current=await storage.workspace.open('工程','src/main.c'),config={...defaultConfig(),classId:'9527',name:'马冬梅',studentId:'7355608'};
 const bundle=await prepareWorkspaceProject(storage,current,config,[{...current,source:current.source+'// draft'}],true),zip=path.join(root,'project.zip');bundle.name='自定义项目.zip';const bytes=submissionZip(bundle);const names=Object.keys(unzipSync(bytes));assert.ok(names.includes('自定义项目/LPMake.txt'));assert.ok(names.includes('自定义项目/src/main.c'));assert.ok(names.includes('自定义项目/common/value.cpp'));assert.ok(names.every(n=>n.startsWith('自定义项目/')));await writeFile(zip,bytes);
 const restored=parseWorkspacePackage(await readProjectArchive(zip));assert.equal(restored.files.find(f=>f.path==='src/main.c')?.content,current.source+'// draft');assert.equal(restored.tests.testCases[0].id,'1');
 await storage.workspace.create('恢复工程','c',restored);assert.equal((await storage.workspace.open('恢复工程','data/input.txt')).source,'hello');
 const bare=await prepareWorkspaceProject(storage,current,config,[],false);assert.ok(bare.files.some(f=>f.name==='LPMake.txt'));assert.ok(!bare.files.some(f=>f.name==='labpad.project.json'));
}));
test('problem-set ZIP with selected versions reconstructs exactly those versions',async()=>temp(async root=>{
 const storage=new Storage(path.join(root,'data'));await storage.init();await storage.importProject({schemaVersion:1,kind:'labpad.project',labId:'L',problems:[{problemId:'P',source:'original'}]});
 const first=(await storage.openDocuments('L','P','c'))[0],second=await storage.newVersion({...first,source:'second'}),config={...defaultConfig(),classId:'9527',name:'马冬梅',studentId:'7355608'};
 const bundle=await prepareProject(storage,first,config,{identity:async()=>'test',format:async s=>s},[first,second],true),zip=path.join(root,'p.zip');await writeFile(zip,submissionZip(bundle));await storage.importProject(await readProjectArchive(zip),'L2');
 assert.deepEqual((await storage.allDocuments('L2','P','c')).map(d=>d.source).sort(),['original','second']);
}));
test('project CLI batch keeps whole candidates, teacher LPMake/tests, roster order and overwritten submission history',async()=>temp(async root=>{
 const pkg=workspacePackage('工程',{files,inheritDefaults:true},{...defaultProblem('工程',''),testCases:[{id:'a',input:'1',expectedOutput:'4'},{id:'b',input:'2',expectedOutput:'5'}]});
 await mkdir(path.join(root,'submit'),{recursive:true});await writeFile(path.join(root,'project.json'),JSON.stringify(pkg));await writeFile(path.join(root,'roster.csv'),'序号,学号,姓名\n2,002,马冬梅\n1,001,测试同学\n3,003,未交同学\n');
 await writeFile(path.join(root,'hidden.json'),JSON.stringify({schemaVersion:1,kind:'labpad.testCases',testCases:[{id:'x',input:'10',expectedOutput:'13'}]}));
 await writeFile(path.join(root,'grade.json'),JSON.stringify({schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{main:1},hiddenTests:{main:'hidden.json'},compiler:{kind:'gcc'},isolation:'none'}));
 const source=(expr:string)=>'#include <stdio.h>\n#include "api.h"\nint main(void){int n;scanf("%d",&n);printf("%d\\n",'+expr+');}';
 const pack=(changed:string)=>Buffer.from(zipSync(Object.fromEntries(Object.entries({...files,'src/main.c':changed,'LPMake.txt':'not executable code'}).map(([n,s])=>['submission/'+n,strToU8(s)]))));
 await writeFile(path.join(root,'submit/002_a.zip'),pack(source('n==1?4:0')));await writeFile(path.join(root,'submit/002_b.zip'),pack(source('n==2?5:0')));await writeFile(path.join(root,'submit/001.zip'),pack(source('n+value()')));
 const result=await runGrade(root,runtime);assert.deepEqual(result.summary.map(r=>r['学号']),['002','001','003']);assert.equal(result.summary[0]['main_通过'],1);assert.equal(result.summary[1]['得分100'],'100.00');assert.equal(result.summary[2]['有效文件'],'否');assert.ok(result.cases.some(c=>c['范围']==='隐藏'));
 const selected=result.summary[1]['main_SHA256'];await writeFile(path.join(root,'submit/001.zip'),pack('invalid code'));const again=await runGrade(root,runtime,{studentId:'001'});assert.equal(again.summary[1]['得分100'],'100.00');assert.equal(again.summary[1]['main_SHA256'],selected);
 assert.ok(Array.isArray(JSON.parse(await readFile(path.join(root,'src/index.json'),'utf8'))));
}));

test('literal sources can be excluded by Glob without being reported missing; source-only export still warns for unchanged templates',async()=>temp(async root=>{
 await mkdir(path.join(root,'src'),{recursive:true});await writeFile(path.join(root,'src/main.c'),'int main(void){return 0;}');await writeFile(path.join(root,'src/unused.c'),'not built');
 const plan=await resolve(parse('target("x")\nadd_files("src/main.c","src/unused.c")\nremove_files("src/unused*")').spec,root);assert.deepEqual(plan.units.map(u=>u.path),['src/main.c']);
 const storage=new Storage(path.join(root,'data'));await storage.init();const current=await storage.workspace.create('模板');
 const preview=await prepareWorkspaceProject(storage,current,defaultConfig(),[],false);assert.ok(preview.warnings.some(w=>w.startsWith('项目源码尚未编辑')));assert.ok(preview.warnings.some(w=>w.startsWith('未填写身份信息')));
}));

test('C and C++ templates remain separate through project import, new versions and ZIP reconstruction',async()=>temp(async root=>{
 const storage=new Storage(path.join(root,'data'));await storage.init();
 const templates={c:'// C starter\n',cpp:['// C++ starter','int main(){return 0;}']};
 await storage.importProject({schemaVersion:2,kind:'labpad.project',mode:'problem-set',labId:'双模板',problems:[{problemId:'P',language:'c',source:'// initial source\n',templates}]});
 const first=(await storage.openDocuments('双模板','P','c'))[0];assert.equal(first.source,'// initial source\n');
 const c=await storage.newVersion({...first,language:'c',source:'student'},true),cpp=await storage.newVersion({...first,language:'cpp'},true);
 assert.equal(c.source,templates.c);assert.equal(cpp.source,templates.cpp.join('\n')+'\n');
 first.source='// student solution\n';const bundle=await prepareProject(storage,first,defaultConfig(),{identity:async()=>'test',format:async s=>s},[first,cpp],true),zip=path.join(root,'p.zip');await writeFile(zip,submissionZip(bundle));
 await storage.importProject(await readProjectArchive(zip),'双模板副本');assert.ok((await storage.allDocuments('双模板副本','P','c')).some(d=>d.source==='// student solution\n'));
 const starter=await storage.newVersion({...first,problem:{...first.problem,labId:'双模板副本'},language:'cpp'},true);assert.equal(starter.source,cpp.source);
}));
test('workspace source templates, generic blank files, nested folders and rename/delete all preserve their boundaries',async()=>temp(async root=>{
 const storage=new Storage(path.join(root,'data'));await storage.init();
 const pkg={...workspacePackage('工程',{files:workspaceTemplate('c'),inheritDefaults:true},defaultProblem('工程','')),templates:{c:'// course C\n',cpp:'// course C++\n'}};
 await storage.workspace.create('工程','c',pkg);
 await storage.workspace.mutate('工程','newFile','src/helper.cpp');assert.equal((await storage.workspace.open('工程','src/helper.cpp')).source,'// course C++\n');
 await storage.workspace.mutate('工程','newFile','src/blank.c',undefined,'');assert.equal((await storage.workspace.open('工程','src/blank.c')).source,'');
 await storage.workspace.mutate('工程','newFolder','notes/nested');await storage.workspace.mutate('工程','newFile','notes/nested/a.txt',undefined,'content');
 await assert.rejects(storage.workspace.mutate('工程','rename','notes','notes/nested/again'),/自身/);
 await storage.workspace.mutate('工程','rename','notes/nested','notes/renamed');assert.equal((await storage.workspace.open('工程','notes/renamed/a.txt')).source,'content');
 await storage.workspace.mutate('工程','delete','notes');assert.ok(!(await storage.workspace.list('工程')).some(f=>f.path.startsWith('notes')));
}));
