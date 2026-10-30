import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {unzipSync} from 'fflate';
import {strictText,validateComparison} from '../shared/comparison';
import {defaultConfig,defaultProblem} from '../shared/defaults';
import {defaultShortcuts,migrateShortcuts,validateShortcuts} from '../shared/shortcuts';
import {operationError} from '../shared/errors';
import {Storage} from '../core/storage';
import {Compiler} from '../core/compiler';
import {judge} from '../core/judge';
import {fingerprint,checkRecord,coverage,exportChoices,prepareProject,submissionZip} from '../core/submission';
import {score100} from '../cli/score';
import {readRoster} from '../cli/roster';
import {collect} from '../cli/collect';
import {runGrade} from '../cli/grade';
import * as XLSX from 'xlsx';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {zipSync,strToU8} from 'fflate';
import type {Draft,JudgeResult} from '../shared/types';
const runtime={toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')};
async function temporary(fn:(dir:string)=>Promise<void>){const dir=await mkdtemp(path.join(tmpdir(),'labpad-dev7-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
const problem=()=>({...defaultProblem('实验2','Lab 2-1'),testCases:[{id:'one',input:'1\n',expectedOutput:'1\n'},{id:'two',input:'2\n',expectedOutput:'2\n'}]});
const echo='#include <stdio.h>\nint main(void){int x;scanf("%d",&x);printf("%d\\n",x);return 0;}';
test('strictText covers indentation, blank lines, trailing spaces, final LF, CRLF, tabs and Unicode without hidden normalization',()=>{
 const check=(a:string,e:string,options={})=>strictText(a,e,{type:'strictText',...options}).accepted;
 assert.ok(check('  A\r\n ABA\r\nABCBA\r\n','  A\n ABA\nABCBA\n'));
 for(const [a,e] of [['A\nABA\nABCBA','  A\n ABA\nABCBA'],['A B','A  B'],['A\n\nB','A\nB'],['A','A\n'],['A ','A'],['\tA','    A'],['Ａ','A'],['\u00a0A',' A'],['A\rB','A\nB']])assert.equal(check(a,e),false);
 assert.ok(check('A \t\nB\n\n','A\nB',{ignoreTrailingSpaces:true,ignoreFinalNewlines:true}));
 assert.equal(check('A\n\nB','A\nB',{ignoreFinalNewlines:true}),false);
 for(const field of ['ignoreTrailingSpaces','ignoreFinalNewlines'])assert.throws(()=>validateComparison({type:'strictText',[field]:'true'}));
 assert.throws(()=>validateComparison({type:'unknown'}));
 assert.match(strictText('A',' A',{type:'strictText'}).message,/第 1 行、第 1 列/);
});
test('partial real runs compile once, preserve original case indexes and only complete same-source coverage can pass',async()=>{
 await temporary(async dir=>{
  const storage=new Storage(dir);await storage.init();const config=defaultConfig(),compiler=new Compiler({...runtime,cacheDirectory:path.join(dir,'cache')});
  const draft:Draft={source:echo,language:'c',problem:problem()};
  try{
   const identity=await compiler.identity(config.compiler,'c'),hash=fingerprint(draft,config.compiler,identity),events:any[]=[];
   const first=await judge(compiler,draft,config.compiler,undefined,e=>events.push(e),['two']);
   assert.equal(first.cases.length,1);assert.equal(first.cases[0].verdict,'AC');assert.equal(events.filter(e=>e.type==='compilation').length,1);assert.equal(events.find(e=>e.type==='case').index,1);
   const record=checkRecord(draft,hash,first);await storage.recordCheck(draft,record);
   assert.equal((await coverage(storage,draft,config,identity)).state,'部分已测');
   const second=await judge(compiler,draft,config.compiler,undefined,undefined,['one']);await storage.recordCheck(draft,checkRecord(draft,hash,second,record));
   assert.equal((await coverage(storage,draft,config,identity)).state,'通过');
   const changed={...draft,source:echo+'\n'};assert.equal((await coverage(storage,changed,config,identity)).state,'需重测');
   await assert.rejects(judge(compiler,draft,config.compiler,undefined,undefined,[]),/有效的测试点/);
   const mixed=structuredClone(draft);mixed.problem.testCases[0].comparison={type:'strictText'};mixed.problem.testCases[0].expectedOutput=' 1\n';
   const bad=await judge(compiler,mixed,config.compiler);assert.deepEqual(bad.cases.map(c=>c.verdict),['WA','AC']);
   const ce=await judge(compiler,{...draft,source:'invalid c'},config.compiler);const failed=checkRecord(draft,hash,ce,record);await storage.recordCheck(draft,failed);assert.notEqual(failed.status,'passed');assert.equal((await coverage(storage,draft,config,identity)).state,'未通过');
  }finally{await compiler.dispose();}
 });
});
test('whole-version export includes all managed versions, overlays unsaved content and emits unique selected-only names',async()=>{
 await temporary(async dir=>{
  const storage=new Storage(dir);await storage.init();await storage.importProject({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases:problem().testCases},{problemId:'Lab 2-2'}]});
  const first=(await storage.openDocuments('实验2','Lab 2-1','c'))[0];const versions=[first];
  for(let i=0;i<6;i++)versions.push(await storage.newVersion({...first,source:'// version '+i}));
  assert.equal((await storage.openDocuments('实验2','Lab 2-1','c')).length,5);
  const selected=versions.at(-1)!;selected.source='// unsaved';const choices=await exportChoices(storage,selected,[selected]);
  assert.equal(choices[0].versions.length,7);assert.equal(choices[0].versions.find(v=>v.documentId===selected.documentId)?.source,'// unsaved');
  const config={...defaultConfig(),classId:'9527',name:'马冬梅',studentId:'7355608'},services={identity:async()=>'test',format:async(s:string)=>s};
  const prepared=await prepareProject(storage,selected,config,services,[selected,versions[0]]);
  assert.deepEqual(prepared.files.map(f=>f.name),['7355608_Lab 2-1.c','7355608_Lab 2-1_v2.c']);
  assert.equal(Object.keys(unzipSync(submissionZip(prepared))).length,2);assert.ok(!prepared.warnings.join('').includes('Lab 2-2'));
  const recent=await storage.recentDocument('实验2','Lab 2-1',[selected.documentId!]);assert.notEqual(recent?.source,'// unsaved');
  await rm(selected.sourceFile!);assert.notEqual((await storage.recentDocument('实验2','Lab 2-1',[selected.documentId!]))?.documentId,selected.documentId);
  await assert.rejects(storage.allDocuments('实验2','Lab 2-1','c'),/源码文件不存在/);
 });
});
test('Mac defaults expand Mod per platform, preserve custom keys and reject system and duplicate bindings',()=>{
 const mac=defaultShortcuts('darwin'),win=defaultShortcuts('win32');
 assert.deepEqual(mac.close,['$mod+KeyW']);assert.deepEqual(mac.saveAll,['$mod+Alt+KeyS']);assert.deepEqual(mac.run,['F9','Control+Enter']);
 assert.deepEqual(validateShortcuts(mac,'darwin'),mac);assert.deepEqual(validateShortcuts(win,'win32'),win);
 assert.deepEqual(migrateShortcuts({...win,run:['F7']},'darwin').run,['F7']);
 assert.deepEqual(migrateShortcuts(win,'darwin').close,['$mod+KeyW']);
 for(const key of ['Meta+KeyH','Meta+KeyM','Meta+KeyQ'])assert.throws(()=>validateShortcuts({...mac,run:[key]},'darwin'),/系统/);
 assert.throws(()=>validateShortcuts({...mac,run:['Meta+KeyS']},'darwin'),/重复/);
});
test('operation errors keep exact reason while compiler text is never passed through the UI wrapper cleanup',()=>{
 assert.equal(operationError(new Error("Error invoking remote method 'problem:import': Error: 原因")),'原因');
 assert.equal(operationError(new Error('路径不存在')),'路径不存在');
});
test('percentage scoring uses exact totals, closes displayed parts and deduction for uneven fractions',()=>{
 for(const items of [[{weight:2,passed:1,total:3},{weight:3,passed:2,total:7}],[{weight:1,passed:1,total:3},{weight:1,passed:1,total:3},{weight:1,passed:1,total:3}]]){
  const s=score100(items);assert.equal(Math.round(s.parts.reduce((a,b)=>a+b,0)*100),Math.round(s.total*100));assert.equal(Math.round((s.total+s.deduction)*100),10000);
 }
 assert.equal(score100([{weight:2,passed:2,total:2},{weight:3,passed:1,total:2}]).total,70);
 assert.throws(()=>score100([{weight:1,passed:0,total:0}]));
});
test('XLS and XLSX roster header discovery preserves original order, sequences and text IDs',async()=>{
 await temporary(async dir=>{
  for(const bookType of ['xls','xlsx'] as const){
   const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['示例名单'],[],[],[],[],['序号','学号','姓名'],['2','002','马冬梅'],['1','001','测试同学']]),'名单');
   const file=path.join(dir,'roster.'+bookType);await writeFile(file,XLSX.write(wb,{type:'buffer',bookType}));
   const roster=await readRoster(file);assert.deepEqual(roster.map(s=>s.studentId),['002','001']);assert.deepEqual(roster.map(s=>s.sequence),['2','1']);
  }
 });
});
test('CLI grades complete versions with private cases, keeps roster order and comments, and rejects a stale partial rerun atomically',async()=>{
 await temporary(async dir=>{
  await mkdir(path.join(dir,'submit'),{recursive:true});await writeFile(path.join(dir,'roster.csv'),'序号,学号,姓名\n2,002,马冬梅\n1,001,测试同学\n3,003,未交同学\n');
  const project={schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases:[{id:'a',input:'1\n',expectedOutput:'1\n'}]},{problemId:'Lab 2-2',testCases:[{id:'a',input:'',expectedOutput:'ok\n'}]}]};
  await writeFile(path.join(dir,'project.json'),JSON.stringify(project));await writeFile(path.join(dir,'hidden.json'),JSON.stringify({schemaVersion:1,kind:'labpad.testCases',testCases:[{id:'b',input:'2\n',expectedOutput:'2\n'}]}));
  const config={schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{'Lab 2-1':2,'Lab 2-2':3},hiddenTests:{'Lab 2-1':'hidden.json'},compiler:{kind:'gcc'},isolation:'none'};
  await writeFile(path.join(dir,'grade.json'),JSON.stringify(config));
  const prints=(n:string)=>'#include <stdio.h>\nint main(void){puts("'+n+'");return 0;}';
  await writeFile(path.join(dir,'submit','002_Lab 2-1.c'),prints('1'));await writeFile(path.join(dir,'submit','002_Lab 2-1_v2.c'),prints('2'));
  await writeFile(path.join(dir,'submit','002_Lab 2-2.c'),prints('ok'));
  const inner=zipSync({'001_Lab 2-1.c':strToU8(echo),'001_Lab 2-1_v10.cpp':strToU8('#include <cstdio>\nint main(){puts("1");}'),'001_Lab 2-2.c':strToU8('invalid c')});
  await writeFile(path.join(dir,'submit','all.zip'),Buffer.from(zipSync({'submission.zip':inner})));
  const report=await runGrade(dir,runtime);assert.deepEqual(report.summary.map(r=>r['学号']),['002','001','003']);assert.deepEqual(report.issues,[]);
  assert.equal(report.summary[0]['得分100'],'80.00');assert.equal(report.summary[0]['Lab 2-1_通过'],1);
  assert.equal(report.summary[1]['得分100'],'40.00');assert.equal(report.summary[1]['有效文件'],'是');assert.equal(report.summary[2]['得分100'],'0.00');
  assert.equal(report.cases.filter(r=>r['学号']==='001'&&r['题号']==='Lab 2-2')[0]['结果'],'CE');
  assert.equal(report.cases.filter(r=>r['学号']==='001'&&r['题号']==='Lab 2-2')[0]['是否运行'],'否');
  assert.ok(report.cases.some(r=>r['范围']==='隐藏'));assert.equal((await readFile(path.join(dir,'output','summary.csv'))).subarray(0,3).toString('hex'),'efbbbf');
  const csv=path.join(dir,'output','summary.csv'),old=parse(await readFile(csv,'utf8'),{bom:true,columns:true}) as Record<string,string>[];old[1]['评语']='外部评语，含"引号"\n第二行';await writeFile(csv,stringify(old,{header:true,bom:true}));
  await writeFile(path.join(dir,'submit','002_Lab 2-1_v3.c'),echo);await runGrade(dir,runtime,{studentId:'002'});
  const after=parse(await readFile(csv,'utf8'),{bom:true,columns:true}) as Record<string,string>[];assert.equal(after[0]['得分100'],'100.00');assert.equal(after[1]['评语'],old[1]['评语']);assert.equal(after[1]['得分100'],old[1]['得分100']);
  const before=await readFile(csv,'utf8');await writeFile(path.join(dir,'grade.json'),JSON.stringify({...config,weights:{'Lab 2-1':1,'Lab 2-2':1}}));
  await assert.rejects(runGrade(dir,runtime,{studentId:'002'}),/全量重测/);assert.equal(await readFile(csv,'utf8'),before);
  assert.ok(!(await (await import('node:fs/promises')).readdir(path.join(dir,'build'))).some(n=>n.startsWith('labpad-runtime-')));
 });
});
test('ZIP collection preserves duplicate provenance, rejects traversal and unreadable submissions remain pending rather than zero',async()=>{
 await temporary(async dir=>{
  const submit=path.join(dir,'submit');await mkdir(submit);
  await writeFile(path.join(submit,'001-bad.zip'),Buffer.from('not a zip'));
  await writeFile(path.join(submit,'001_Lab 2-1.c'),Buffer.alloc(0));
  await writeFile(path.join(submit,'001_Lab 2-1_v2.c'),Buffer.from([0,0xff,0x11]));
  const result=await collect(submit,path.join(dir,'src'),[{sequence:'1',studentId:'001',name:'测试同学'}],['Lab 2-1']);
  assert.equal(result.empty.length,1);assert.equal(result.candidates.length,0);assert.ok(result.issues.some(i=>i.message.includes('ZIP')));assert.ok(result.issues.every(i=>i.pending));
 });
});

test('real Bubblewrap runs UTF-8 programs with grading files outside the exposed case directory',async t=>{
 try{await (await import('../cli/grade')).executable('bwrap');}catch{t.skip('Bubblewrap is not installed');return;}
 await temporary(async dir=>{
  const compiler=new Compiler({...runtime,workDirectory:path.join(dir,'build'),cacheDirectory:path.join(dir,'cache'),isolation:'bubblewrap'});
  const config={...defaultConfig().compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
  const secret=path.join(dir,'hidden-answer.txt');await writeFile(secret,'private');
  const source='#include <stdio.h>\nint main(void){FILE *f=fopen("'+secret+'","r");if(f)return 9;puts("隔离通过");return 0;}';
  try{
   const p={...defaultProblem('实验2','隔离'),testCases:[{id:'1',input:'',expectedOutput:'隔离通过\n'}]};
   const result=await judge(compiler,{source,language:'c',problem:p},config);assert.equal(result.status,'completed',result.error);assert.equal(result.cases[0]?.verdict,'AC',JSON.stringify(result));
  }finally{await compiler.dispose();}
 });
});

test('duplicate ZIP names remain separate versions and traversal or link entries never become source files',async()=>{
 await temporary(async dir=>{
  const submit=path.join(dir,'submit');await mkdir(submit);const a='001_Lab 2-1_v2.c',b='001_Lab 2-1_v3.c';
  const bytes=Buffer.from(zipSync({[a]:strToU8('int main(void){return 1;}'),[b]:strToU8('int main(void){return 2;}')}));
  let at=0;while((at=bytes.indexOf(Buffer.from(b),at))>=0){Buffer.from(a).copy(bytes,at);at+=a.length;}
  await writeFile(path.join(submit,'001-duplicates.zip'),bytes);
  await writeFile(path.join(submit,'001-traversal.zip'),Buffer.from(zipSync({'../001_Lab 2-1.c':strToU8('int main(void){return 0;}')})));
  const links=Buffer.from(zipSync({'001_Lab 2-1.c':strToU8('/etc/passwd')})),central=links.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  links.writeUInt16LE((3<<8)|20,central+4);links.writeUInt32LE((0o120777*65536)>>>0,central+38);await writeFile(path.join(submit,'001-link.zip'),links);
  const result=await collect(submit,path.join(dir,'src'),[{sequence:'1',studentId:'001',name:'测试同学'}],['Lab 2-1']);
  assert.equal(result.candidates.length,2);assert.notEqual(result.candidates[0].key,result.candidates[1].key);assert.ok(result.candidates.every(c=>c.problemId==='Lab 2-1'));
  assert.ok(result.issues.some(i=>/链接/.test(i.message)));assert.ok(result.issues.some(i=>/ZIP/.test(i.message)));
 });
});
test('a corrupt alternate keeps a partial score pending, a confirmed full version resolves it, and a first single rerun leaves other rows ungraded',async()=>{
 await temporary(async dir=>{
  await mkdir(path.join(dir,'submit'));await writeFile(path.join(dir,'roster.csv'),'序号,学号,姓名\n1,001,测试同学\n2,002,另一同学\n');
  const project={schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases:problem().testCases}]};
  await writeFile(path.join(dir,'project.json'),JSON.stringify(project));await writeFile(path.join(dir,'grade.json'),JSON.stringify({schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{'Lab 2-1':1},compiler:{kind:'gcc'},isolation:'none'}));
  await writeFile(path.join(dir,'submit','001-bad.zip'),'invalid zip');await writeFile(path.join(dir,'submit','001_Lab 2-1.c'),'#include <stdio.h>\nint main(void){puts("1");return 0;}');
  const first=await runGrade(dir,runtime,{studentId:'001'});assert.equal(first.summary[0]['状态'],'待核对');assert.equal(first.summary[0]['得分100'],'');assert.equal(first.summary[1]['状态'],'未送测');assert.equal(first.summary[1]['得分100'],'');
  await writeFile(path.join(dir,'submit','001_Lab 2-1_v2.c'),echo);const full=await runGrade(dir,runtime,{studentId:'001'});assert.equal(full.summary[0]['得分100'],'100.00');assert.equal(full.summary[0]['状态'],'已完成');
  const original=await readFile(path.join(dir,'output','summary.csv'),'utf8'),abort=new AbortController();abort.abort();await assert.rejects(runGrade(dir,runtime,{signal:abort.signal}));assert.equal(await readFile(path.join(dir,'output','summary.csv'),'utf8'),original);
 });
});

test('batch rejects an invalid toolchain before assigning compilation failures to students',async()=>{
 await temporary(async dir=>{
  await mkdir(path.join(dir,'submit'));await writeFile(path.join(dir,'roster.csv'),'序号,学号,姓名\n1,001,测试同学\n');
  await writeFile(path.join(dir,'project.json'),JSON.stringify({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases:problem().testCases}]}));
  await writeFile(path.join(dir,'grade.json'),JSON.stringify({schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{'Lab 2-1':1},compiler:{kind:'gcc',cArgs:['--labpad-invalid-option']},isolation:'none'}));
  await assert.rejects(runGrade(dir,runtime),/工具链自检失败/);
  assert.equal(await (await import('../core/storage')).exists(path.join(dir,'output','summary.csv')),false);
 });
});

test('resubmitting under the same filename retains earlier complete versions and stable tie order',async()=>{
 await temporary(async dir=>{
  await mkdir(path.join(dir,'submit'));await writeFile(path.join(dir,'roster.csv'),'序号,学号,姓名\n1,001,测试同学\n');
  await writeFile(path.join(dir,'project.json'),JSON.stringify({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',testCases:problem().testCases}]}));
  await writeFile(path.join(dir,'grade.json'),JSON.stringify({schemaVersion:1,project:'project.json',roster:'roster.csv',weights:{'Lab 2-1':1},compiler:{kind:'gcc'},isolation:'none'}));
  const submission=path.join(dir,'submit','001_Lab 2-1.c');await writeFile(submission,echo);const first=await runGrade(dir,runtime);assert.equal(first.summary[0]['得分100'],'100.00');
  await writeFile(submission,'#include <stdio.h>\nint main(void){puts("1");return 0;}');const second=await runGrade(dir,runtime);assert.equal(second.summary[0]['得分100'],'100.00');assert.equal(second.summary[0]['Lab 2-1_SHA256'],first.summary[0]['Lab 2-1_SHA256']);
  const index=JSON.parse(await readFile(path.join(dir,'src/index.json'),'utf8'));assert.equal(index.length,2);assert.ok(index.every((v:any)=>v.labId==='实验2'&&v.ordinal>0));
  await runGrade(dir,runtime);assert.equal(JSON.parse(await readFile(path.join(dir,'src/index.json'),'utf8')).length,2);
  const savedCsv=await readFile(path.join(dir,'output/summary.csv'),'utf8');await writeFile(path.join(dir,'src/index.json'),JSON.stringify([{...index[0],studentId:null}]));await assert.rejects(runGrade(dir,runtime),/索引记录无效/);assert.equal(await readFile(path.join(dir,'output/summary.csv'),'utf8'),savedCsv);
 });
});
