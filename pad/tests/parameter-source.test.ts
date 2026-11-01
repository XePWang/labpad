import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {parse,relative,editList,editSingle} from '../shared/lpmake';
import {sourceNames,projectPlan,draftPlan,independentMake,previewPlan,expandProjectArgument} from '../core/build/plan';
import {workspaceTemplate,defaultLpmake,parseWorkspacePackage,workspacePackage} from '../shared/workspace';
import {restorePackage} from '../core/project-archive';
import {defaultConfig,defaultProblem} from '../shared/defaults';import {Storage} from '../core/storage';import {Compiler} from '../core/compiler';import {compileDraft} from '../core/build';
const inventory=['main.c','main.cpp','src/root.c','src/test_one.c','src/deep/child.c','src/deep/test_two.c','src/深 目录/中文.c','src/keep.c','src/main.cpp','src/.hidden.c','.hidden.c'];
const selected=(pattern:string,remove?:string)=>sourceNames(parse('target("app")\nadd_files('+JSON.stringify(pattern)+')\n'+(remove?'remove_files('+JSON.stringify(remove)+')':'')).spec,inventory);
const comments=(s:string)=>{const out:string[]=[],c=parse(s);let cursor=(awaitParser(s));do{if(/Comment$/.test(cursor.name))out.push(s.slice(cursor.from,cursor.to));}while(cursor.next());return out;};
import {parser} from '../shared/lpmake';const awaitParser=(s:string)=>parser.parse(s).cursor();
test('Xmake-style shorthand and standard globstar have identical root and prefixed semantics',()=>{
 assert.deepEqual(selected('*.c'),['main.c']);assert.deepEqual(selected('./*.c'),['main.c']);
 assert.deepEqual(selected('**.c'),selected('**/*.c'));assert.deepEqual(selected('./**.c'),selected('./**/*.c'));
 assert.deepEqual(selected('src/**.c'),selected('src/**/*.c'));assert.ok(selected('src/**.c').includes('src/deep/child.c'));
 assert.deepEqual(selected('src/**test_*.c'),selected('src/**/*test_*.c'));assert.ok(!selected('src/*.c').includes('src/deep/child.c'));
 assert.ok(!selected('**.c').includes('main.cpp'));assert.ok(!selected('**.c').some(f=>f.includes('.hidden')));
});
test('Xmake exclusion filters use the include-pattern base; remove_files shares the same matcher',()=>{
 assert.deepEqual(selected('src/**.c|test_one.c|deep/**.c'),['src/keep.c','src/root.c','src/深 目录/中文.c']);
 assert.deepEqual(selected('src/**.c','src/**test_*.c'),['src/deep/child.c','src/keep.c','src/root.c','src/深 目录/中文.c']);
 const spec=parse('target("x")\nadd_files("./**.c","src/**/*.c")\nremove_files("src/**.c|keep.c")').spec;
 assert.deepEqual(sourceNames(spec,inventory),['main.c','src/keep.c']);
 assert.throws(()=>selected('src/**.c|'),/Empty file pattern/);
 assert.deepEqual(selected('./*.{c,cpp}'),['main.c','main.cpp']);assert.deepEqual(selected('src/roo?.c'),['src/root.c']);assert.deepEqual(selected('src/[kr]*.c'),['src/keep.c','src/root.c']);
});
test('dot, slash, root variable and portable separators normalize without allowing parent traversal',()=>{
 for(const value of ['.','./','././','$(projectdir)','$(projectdir)/'])assert.equal(relative(value),'.');
 for(const value of ['./src','src/','src//./','src\\','$(projectdir)/src'])assert.equal(relative(value),'src');
 for(const value of ['../src','./../src','/src','C:/src','\\\\server\\src','$(projectdir)/../src'])assert.throws(()=>relative(value));
 assert.deepEqual(selected('$(projectdir)/**.c'),selected('./**.c'));
 assert.equal(expandProjectArgument('$(projectdir)/include','/work/project'),'/work/project/include');
 assert.equal(expandProjectArgument('$$(projectdir)','/work/project'),'$(projectdir)');
});
test('common quoted, multiline, comma, semicolon and comment spellings retain arguments and CST comments',()=>{
 const text="-- heading\n--[[block\ncomment]]\ntarget('app'); # target\nset_standard('c17');\nadd_files(\n './*.c', -- source\n './*.cpp',\n);\nadd_defines('MESSAGE=\"hello world\"', 'APOSTROPHE=it\\'s');\n";
 const spec=parse(text).spec;assert.deepEqual(spec.defines,['MESSAGE="hello world"',"APOSTROPHE=it's"]);
 const edited=editList(text,'add_files',['./**.c','./**.cpp']);assert.deepEqual(parse(edited).spec.sources,['./**.c','./**.cpp']);assert.deepEqual(comments(edited),comments(text));
 const empty=editList(text,'add_files',[]);assert.deepEqual(comments(empty),comments(text));
 assert.equal(parse(editSingle(text,'set_standard','c11','c')).spec.standards.c,'c11');
 assert.throws(()=>parse('target("a")\nadd_files("\\q")'),/Invalid escape sequence/);
 assert.throws(()=>parse('target("a")\nadd_files("\\u0000")'),/NUL/);
});
test('Xmake declaration aliases preserve standard families, argument order and CST comments through form editing',()=>{
 const text=`-- configuration
target('app'); set_kind("binary")
set_languages("c17", -- C standard
 "cxx20") -- both languages
set_optimize("faster")
add_files("./**.c", "./**.cpp")
add_cflags("-DFIRST=1")
add_cxflags("-Wall", -- shared warning
 "-Wextra")
add_cxxflags("-DLAST=1")
del_files("test/**.c") # exclusion
`;
 const spec=parse(text).spec;assert.deepEqual(spec.standards,{c:'c17',cpp:'c++20'});assert.equal(spec.optimize,'O2');
 assert.deepEqual(spec.cflags,['-DFIRST=1','-Wall','-Wextra']);assert.deepEqual(spec.cxxflags,['-Wall','-Wextra','-DLAST=1']);assert.deepEqual(spec.exclude,['test/**.c']);
 assert.equal(editSingle(text,'set_standard','c++20','cpp'),text);assert.equal(editSingle(text,'set_optimize','O2'),text);
 assert.equal(editList(text,'add_cflags',spec.cflags),text);assert.equal(editList(text,'remove_files',spec.exclude),text);
 const changed=editSingle(editList(text,'add_cflags',['-DCHANGED=1']),'set_standard','c11','c');
 assert.deepEqual(parse(changed).spec.standards,{c:'c11',cpp:'c++20'});assert.deepEqual(parse(changed).spec.cflags,['-DCHANGED=1']);assert.deepEqual(parse(changed).spec.cxxflags,spec.cxxflags);
 assert.deepEqual(comments(changed),comments(text));assert.equal(parse(editSingle(changed,'set_standard',undefined,'cpp')).spec.standards.cpp,undefined);
 assert.deepEqual(parse(editList(text,'remove_files',['other/**.c'])).spec.exclude,['other/**.c']);
 for(const [name,value]of Object.entries({none:'O0',fast:'O1',faster:'O2',fastest:'O3',smallest:'Os'}))assert.equal(parse('target("a")\nset_optimize("'+name+'")').spec.optimize,value);
 for(const [value,expected]of Object.entries({cxx11:'c++11',gnuxx20:'gnu++20',cxx1z:'c++17',cxx2a:'c++20',cxx2b:'c++23'}))assert.equal(parse('target("a")\nset_languages("'+value+'")').spec.standards.cpp,expected);
 assert.throws(()=>parse('target("a")\nset_languages("c11","c17")'),/Duplicate language standard/);
 assert.throws(()=>parse('target("a")\nset_languages("cxx20")\nset_standard("c++17")'),/Duplicate language standard/);
});
test('unsupported Lua and target kinds receive actionable English diagnostics without execution',()=>{
 for(const [source,hint]of [['set_warnings("all")','add_cflags'],['set_symbols("debug")','set_mode'],['set_kind("static")','one executable']])assert.throws(()=>parse('target("a")\n'+source),new RegExp('hint: .*'+hint));
 assert.throws(()=>parse('target("a")\nif is_plat("windows") then'),/LPMake.txt:2:/);
});
test('fixed templates are independent of personal globals and missing build files receive only the template',()=>{
 for(const language of ['c','cpp'] as const){const files=workspaceTemplate(language);assert.ok(files['main.'+language]);assert.ok(!files['src/main.'+language]);const spec=parse(files['LPMake.txt']).spec;assert.deepEqual(spec.standards,{c:'c17',cpp:'c++20'});assert.equal(spec.mode,'debug');assert.deepEqual(spec.includeDirs,['./']);assert.deepEqual(spec.links,['m']);}
 const pkg=parseWorkspacePackage({schemaVersion:2,kind:'labpad.project',mode:'project',labId:'Project',files:[{path:'nested/main.c',content:'source'}]});
 assert.equal(pkg.templateFilled,true);assert.equal(pkg.files.find(f=>f.path==='LPMake.txt')!.content,defaultLpmake());assert.equal(pkg.files.find(f=>f.path==='nested/main.c')!.content,'source');
 assert.equal(Object.hasOwn(pkg.build,'inheritDefaults'),false);
 const draft={source:'',language:'c' as const,problem:defaultProblem('P',''),workspace:{files:workspaceTemplate('c')}},config=defaultConfig().compiler;
 assert.deepEqual(draftPlan(draft,config),draftPlan(draft,{...config,cArgs:['-std=c89','-DUNRELATED'],cppArgs:['-c'],linkArgs:['-bad-global']}));
 const exported=workspacePackage('P',draft.workspace,draft.problem);assert.equal(Object.hasOwn(exported.build,'inheritDefaults'),false);
 const value=previewPlan(draft,config);assert.ok(value.units[0].args.includes('-O0'));assert.ok(value.units[0].args.includes('-Wall'));assert.ok(!value.layers.flatMap(l=>l.groups).some(g=>g.label==='本机默认参数'));
});
test('ZIP restoration fills only missing LPMake while retaining errors for missing source files',()=>{
 const descriptor={schemaVersion:2,kind:'labpad.project',mode:'project',labId:'P',files:[{path:'LPMake.txt'},{path:'main.c'}]};
 const pkg=parseWorkspacePackage(restorePackage({'labpad.project.json':JSON.stringify(descriptor),'main.c':'int main(void){return 0;}'}));
 assert.equal(pkg.templateFilled,true);assert.equal(pkg.files.find(f=>f.path==='LPMake.txt')!.content,defaultLpmake());
 assert.throws(()=>restorePackage({'labpad.project.json':JSON.stringify(descriptor)}),/main.c/);
});
const temp=async(fn:(root:string)=>Promise<void>)=>{const root=await mkdtemp(path.join(os.tmpdir(),'labpad-parameters-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};
test('legacy inherited workspaces migrate once to explicit text, keep source layout and no longer follow globals',async()=>temp(async root=>{
 const storage=new Storage(root);const config=await storage.init();config.compiler.cArgs=['-std=c11','-O3','-Wall','-DVALUE=11'];await storage.saveConfig(config);
 const make='target("old")\nset_standard("c17")\nadd_includedirs(".")\nadd_files("main.c")\nadd_defines("VALUE=22")\nadd_links("m")\n';
 await storage.workspace.create('Old','c',{schemaVersion:2,kind:'labpad.project',mode:'project',labId:'Old',build:{system:'lpmake',file:'LPMake.txt'},files:[{path:'LPMake.txt',content:make},{path:'main.c',content:'int main(void){return 0;}'}]});
 const metaFile=storage.workspace.metadata('Old'),meta=JSON.parse(await readFile(metaFile,'utf8'));meta.inheritDefaults=true;await writeFile(metaFile,JSON.stringify(meta));
 const state=await storage.workspace.read('Old'),snapshot=await storage.workspace.snapshot('Old');assert.equal(Object.hasOwn(state,'inheritDefaults'),false);assert.equal(Object.hasOwn(snapshot,'inheritDefaults'),false);
 assert.ok(snapshot.files['LPMake.txt'].includes('$(projectdir)'));assert.ok(snapshot.files['LPMake.txt'].includes('VALUE=11'));assert.ok(snapshot.files['LPMake.txt'].includes('VALUE=22'));
 const draft={source:'',language:'c' as const,problem:state.tests,workspace:snapshot};const before=draftPlan(draft,config.compiler);config.compiler.cArgs=['-std=c89','-DVALUE=999'];await storage.saveConfig(config);
 assert.deepEqual(draftPlan(draft,config.compiler),before);assert.equal((await storage.workspace.snapshot('Old')).files['LPMake.txt'],snapshot.files['LPMake.txt']);
}));
test('legacy flag materialization preserves a real GCC macro/header/math build and linker sequence',async()=>temp(async root=>{
 const config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'gcc',cppPath:'g++',cArgs:['-std=c11','-O3','-DVALUE=11'],linkArgs:['-Wl,--start-group','-lm','-Wl,--end-group']};
 const source='#include <stdio.h>\n#include <math.h>\n#include "api.h"\nint main(void){volatile double x=4.0;printf("%d %.0f",VALUE+EXTRA,sqrt(x));}\n',make='target("legacy")\nset_standard("c17")\nadd_files("main.c")\nadd_includedirs(".")\nadd_defines("VALUE=22")\nadd_links("m")\n';
 const text=independentMake(make.replace('add_includedirs(".")','add_includedirs("include")'),{c:config.cArgs,cpp:config.cppArgs,link:config.linkArgs});const files={'LPMake.txt':text,'main.c':source,'include/api.h':'#define EXTRA 3\n'},problem=defaultProblem('Old','');
 const compiler=new Compiler({toolchain:'',checkers:'',cacheDirectory:path.join(root,'cache'),workDirectory:path.join(root,'runs')});
 try{const result=await compileDraft(compiler,{source:'',language:'c',problem,workspace:{files}},config);try{assert.equal(result.compilation.status,'success',result.compilation.stderr);const run=await import('../core/process');const output=await run.runProcess(result.executable,[],{cwd:result.directory,timeLimitMs:1000,outputLimitBytes:1024});assert.equal(output.stdout.toString(),'25 2');}finally{await result.cleanup();}}finally{await compiler.dispose();}
 const spec=parse(text).spec;assert.deepEqual(projectPlan(spec,['main.c'],{c:[],cpp:[],link:[]},false).linkArgs,config.linkArgs.concat('-lm'));
}));

test('parameter source saves both scopes atomically and preserves inactive project arrays through a restart',async()=>temp(async root=>{
 const storage=new Storage(root),config=await storage.init();await storage.createLab('Set');const project={inheritDefaults:false,cArgs:['-std=c11','-DPROJECT=7'],cppArgs:['-std=c++20'],linkArgs:[]};
 const global={...config,compiler:{...config.compiler,cArgs:['-std=c17','-DGLOBAL=3']}};
 await storage.saveSettings(global,{lab:'Set',options:project});
 await storage.saveSettings(global,{lab:'Set',options:{...project,inheritDefaults:true}});
 const stored=await new Storage(root).buildOptions('Set');assert.equal(stored!.inheritDefaults,true);assert.deepEqual(stored!.cArgs,project.cArgs);
 const configFile=path.join(root,'config.json'),metaFile=path.join(root,'projects/Set/.labpad'),before=await readFile(configFile),meta=await readFile(metaFile),write=(storage as any).writeState;
 (storage as any).writeState=async()=>{throw Error('late settings failure');};
 await assert.rejects(storage.saveSettings({...global,name:'Example'},{lab:'Set',options:project}),/late settings failure/);
 assert.deepEqual(await readFile(configFile),before);assert.deepEqual(await readFile(metaFile),meta);
 (storage as any).writeState=write;await storage.saveSettings(global,{lab:'Set',options:project});
 assert.equal((await new Storage(root).buildOptions('Set'))!.inheritDefaults,false);
 assert.deepEqual((await new Storage(root).init()).compiler.cArgs,global.compiler.cArgs);
}));
test('beginner warning defaults report shadow, conversion, undefined macros and variable format strings without failing compilation',async()=>temp(async root=>{
 const config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'gcc',cppPath:'g++'},compiler=new Compiler({toolchain:'',checkers:'',workDirectory:root,cacheDirectory:path.join(root,'cache')});
 const source='#include <stdio.h>\n#if UNKNOWN_SWITCH\n#endif\nint main(int argc,char **argv){int value=1;{int value=2;printf("%d",value);}double number=3.5;int narrowed=number;if(argc>1)printf(argv[1]);return value+narrowed;}\n';
 try{const result=await compiler.compile(source,'c',config);try{assert.equal(result.compilation.status,'success',result.compilation.stderr);for(const warning of ['-Wshadow','conversion','-Wundef','format-security'])assert.ok(result.compilation.stderr.includes(warning),result.compilation.stderr);}finally{await result.cleanup();}}finally{await compiler.dispose();}
}));

test('logical math library remains in LPMake while MSVC targets use the C runtime and GNU targets link libm',()=>{
 const draft={source:'',language:'c' as const,problem:defaultProblem('P',''),workspace:{files:workspaceTemplate('c')}},base=defaultConfig().compiler;
 const msvc=previewPlan(draft,{...base,linkTarget:'x86_64-pc-windows-msvc'}),gnu=previewPlan(draft,{...base,linkTarget:'x86_64-w64-windows-gnu'});
 assert.equal(parse(draft.workspace.files['LPMake.txt']).spec.links[0],'m');assert.ok(!msvc.linkArgs.includes('-lm'));assert.ok(gnu.linkArgs.includes('-lm'));assert.ok(msvc.issues.some(i=>i.field==='link'&&i.message.includes('C 运行库')));
 const explicit={...draft,workspace:{files:{...draft.workspace.files,'LPMake.txt':draft.workspace.files['LPMake.txt']+'add_ldflags("-lm")\n'}}};
 assert.ok(draftPlan(explicit,{...base,linkTarget:'x86_64-windows-msvc'}).linkArgs.includes('-lm'));
});

test('compatible declaration aliases build and link a real mixed GCC project',async()=>temp(async root=>{
 const config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'gcc',cppPath:'g++'},compiler=new Compiler({toolchain:'',checkers:'',workDirectory:root,cacheDirectory:path.join(root,'cache')});
 const files={'LPMake.txt':'target("alias")\nset_kind("binary")\nset_languages("c17","cxx20")\nset_optimize("none")\nadd_files("./**.c","./**.cpp")\nadd_cxflags("-Wall")\ndel_files("unused.c")\n','main.cpp':'#include <string>\n#include <cstdio>\nextern "C" int value(void);int main(){std::string x="value";std::printf("%s %d",x.c_str(),value());}\n','nested/value.c':'int value(void){return 42;}\n','unused.c':'invalid excluded source'};
 try{const result=await compileDraft(compiler,{source:'',language:'c',problem:defaultProblem('P',''),workspace:{files}},config);try{assert.equal(result.compilation.status,'success',result.compilation.stderr);const {runProcess}=await import('../core/process');const run=await runProcess(result.executable,[],{cwd:result.directory,timeLimitMs:1000,outputLimitBytes:1024});assert.equal(run.stdout.toString(),'value 42');}finally{await result.cleanup();}}finally{await compiler.dispose();}
}));
