import {withFixtures} from './legacy-flow.cjs';
import {test,expect,_electron} from '@playwright/test';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

for(const language of ['c','cpp'] as const)test(`problem-set (${language}) compilation with rule JSON and save-and-compile`,async()=>{
 test.setTimeout(150000);
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-saved-inputs-')),data=path.join(root,'data');
 const app=await withFixtures(_electron).launch({executablePath:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),args:process.env.LABPAD_TEST_EXECUTABLE?[]:['.'],env:{...process.env,LABPAD_DATA_DIR:data,LABPAD_SKIP_WARMUP:'1'}});
 try{
  const page=await app.firstWindow();await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{(globalThis as any).__saveAnswer='保存并编译';(globalThis as any).__saveDialogs=[];dialog.showMessageBox=async(...args:any[])=>{const o=args.at(-1);(globalThis as any).__saveDialogs.push(o);const name=o.title==='保存修改'?'不保存':(globalThis as any).__saveAnswer;return {response:Math.max(0,o.buttons.indexOf(name)),checkboxChecked:false};};});
  await page.evaluate(async(language)=>{
   const s=await window.labpad.bootstrap();s.config.formatOnSave=false;
   if(navigator.platform.includes('Linux'))s.config.compiler={...s.config.compiler,mode:'custom',kind:'gcc',cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
   await window.labpad.saveConfig(s.config,s.dataRoot);
   await window.labpad.createLab('题集保存检查','problem-set');
   const d=await window.labpad.createProblem('题集保存检查','warmup 2-1',language);
   d.source='#include <stdio.h>\nint main(void){puts("42");return 0;}\n';
   d.problem.testCases=[{id:'answer',input:'',expectedOutput:'42\n'}];
   await window.labpad.saveDraft(d);
   await window.labpad.fileOperation('题集保存检查','warmup 2-1',{action:'newFile',paths:['Lab 2-2.'+language],content:'#include <stdio.h>\nint main(void){puts("42");return 0;}\n'});
   await window.labpad.loadDraft('题集保存检查','warmup 2-1',language);
  },language);
  await page.reload();await page.locator('.toolbar').waitFor();
  if(!await page.locator('.file-tree').isVisible())await page.getByRole('button',{name:'显示文件',exact:true}).click();
  await page.locator('[data-file="warmup 2-1.json"]').click();
  await page.locator('[data-file='+JSON.stringify('Lab 2-2.'+language)+']').click();
  await expect.poll(()=>page.locator('.source-tabs [role=tab]').count()).toBeGreaterThanOrEqual(3);
  expect((await page.evaluate(()=>window.labpad.bootstrap())).draft.problem.testCases).toHaveLength(1);
  await expect(page.locator('.tab-dirty')).toHaveCount(0);
  await page.evaluate(()=>{(window as any).__saveCompiles=[];window.labpad.onJudge(e=>{if(e.type==='compilation')(window as any).__saveCompiles.push(e.compilation);});});
  const compileButton=page.getByRole('button',{name:'编译',exact:true});
  const ready=page.locator('.cases-heading .run-test-icon');
  async function compile(){
   const count=await page.evaluate(()=>(window as any).__saveCompiles.length);
   await compileButton.click();
   await expect.poll(async()=>await page.evaluate(n=>(window as any).__saveCompiles.length>n,count)||await page.locator('.phase').innerText()==='编译失败',{timeout:60000}).toBe(true);
   expect(await page.locator('.phase').innerText()).not.toBe('编译失败');
   await expect.poll(()=>page.evaluate(()=>(window as any).__saveCompiles.length),{timeout:60000}).toBe(count+1);
   await expect(ready).toBeEnabled({timeout:30000});
   expect(await page.evaluate(()=>(window as any).__saveCompiles.length)).toBe(count+1);
   expect(await page.evaluate(()=>(window as any).__saveCompiles.at(-1).status)).toBe('success');
   await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await compile();
  expect(await app.evaluate(()=>(globalThis as any).__saveDialogs.filter((d:any)=>d.title==='保存后编译').length)).toBe(0);
  console.log('PASS saved rule JSON and another source tab do not block a clean problem-set compilation');
  await ready.click();await expect(page.locator('.verdict.ac')).toHaveCount(1);

  // The current JSON is an auxiliary editor document, not a C translation unit.
  await page.locator('.source-tabs [role=tab]').filter({hasText:'warmup 2-1.json'}).click();
  await compile();await ready.click();await expect(page.locator('.verdict.ac')).toHaveCount(1);
  console.log('PASS compiling while the rule JSON tab is active resolves the current saved C version');

  await page.locator('.source-tabs [role=tab]').filter({hasText:'Lab 2-2.'+language}).click();
  await page.evaluate(async()=>{const s=await window.labpad.bootstrap();s.config.formatOnSave=true;await window.labpad.saveConfig(s.config,s.dataRoot);});
  const editor=page.locator('.cm-content');
  await editor.fill('#include <stdio.h>\nint main(void){puts("42");return 0;} // manual save\n');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.getByRole('menuitem',{name:'保存当前',exact:true}).click();
  await expect(page.locator('.source-tab.active .tab-dirty')).toHaveCount(0);
  await compile();await ready.click();await expect(page.locator('.verdict.ac')).toHaveCount(1);
  console.log('PASS manual save then compilation succeeds with the rule JSON still open');

  const sourcePath=(await page.evaluate(()=>window.labpad.bootstrap())).sourcePath!;
  const saved=await readFile(sourcePath,'utf8');
  await editor.fill(saved+'// save and compile\n');
  await app.evaluate(()=>(globalThis as any).__saveAnswer='取消');
  const count=await page.evaluate(()=>(window as any).__saveCompiles.length);
  const dialogs=await app.evaluate(()=>(globalThis as any).__saveDialogs.length);
  await compileButton.click();
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).__saveDialogs.length)).toBe(dialogs+1);
  expect(await readFile(sourcePath,'utf8')).toBe(saved);
  expect(await page.evaluate(()=>(window as any).__saveCompiles.length)).toBe(count);
  await app.evaluate(()=>(globalThis as any).__saveAnswer='保存并编译');
  await compile();await ready.click();await expect(page.locator('.verdict.ac')).toHaveCount(1);
  expect(await readFile(sourcePath,'utf8')).toContain('save and compile');
  console.log('PASS save-and-compile saves once and compiles; cancel starts no compiler and changes no file');
 }finally{
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(...args:any[])=>{const o=args.at(-1);return {response:Math.max(0,o.buttons.indexOf('不保存')),checkboxChecked:false};};}).catch(()=>{});
  await app.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

test('project compilation ignores managed output tabs and still requires saved headers and GBK resources',async()=>{
 test.setTimeout(150000);
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-project-saved-inputs-')),data=path.join(root,'data');
 const app=await withFixtures(_electron).launch({executablePath:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),args:process.env.LABPAD_TEST_EXECUTABLE?[]:['.'],env:{...process.env,LABPAD_DATA_DIR:data,LABPAD_SKIP_WARMUP:'1'}});
 try{
  const page=await app.firstWindow();await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(...args:any[])=>{const o=args.at(-1);return {response:Math.max(0,o.buttons.indexOf(o.title==='保存修改'?'不保存':'保存并编译')),checkboxChecked:false};};});
  await page.evaluate(async()=>{
   const s=await window.labpad.bootstrap();s.config.formatOnSave=false;
   if(navigator.platform.includes('Linux'))s.config.compiler={...s.config.compiler,mode:'custom',kind:'gcc',cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
   await window.labpad.saveConfig(s.config,s.dataRoot);
   const d=await window.labpad.createLab('项目保存检查','project');
   d.source='#include "value.h"\nint main(void){return VALUE;}\n';await window.labpad.saveDraft(d);await window.labpad.loadDraft('项目保存检查','','c');
  });
  const dir=path.join(data,'projects/项目保存检查');
  await mkdir(path.join(dir,'build'));
  await writeFile(path.join(dir,'build/.labpad-build.json'),JSON.stringify({kind:'labpad.build',schemaVersion:1}));
  await writeFile(path.join(dir,'build/log.txt'),'compiler output\n');
  await writeFile(path.join(dir,'value.h'),'#define VALUE 0\n');
  await writeFile(path.join(dir,'notes.txt'),Buffer.from([0xc4,0xe3,0xba,0xc3]));
  await page.reload();await page.locator('.file-tree').waitFor();
  const node=(file:string)=>page.locator('[data-file='+JSON.stringify(file)+']');
  await node('build').click();await node('build/log.txt').click();
  await node('notes.txt').click();await expect(page.locator('.cm-content')).toContainText('你好');
  const compiled=()=>page.evaluate(async()=>window.labpad.compileState((await window.labpad.bootstrap()).draft));
  await page.evaluate(()=>{(window as any).__projectCompiles=0;window.labpad.onJudge(e=>{if(e.type==='compilation')(window as any).__projectCompiles++;});});
  const compile=async()=>{const before=await page.evaluate(()=>(window as any).__projectCompiles);await page.getByRole('button',{name:'编译',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__projectCompiles),{timeout:60000}).toBe(before+1);await expect.poll(async()=>(await compiled()).ready).toBe(true);await expect.poll(()=>page.locator('.phase').innerText(),{timeout:30000}).toBe('调试结束');await page.evaluate(async()=>window.labpad.buildPreview((await window.labpad.bootstrap()).draft));await expect(page.getByRole('alert')).toHaveCount(0);};
  await expect.poll(async()=>(await compiled()).saved).toBe(true);
  await compile();
  console.log('PASS saved generated-file and GBK resource tabs do not block project compilation');
  await page.locator('.cm-content').fill('您好');
  await expect.poll(async()=>(await compiled()).saved).toBe(false);
  await compile();expect(await readFile(path.join(dir,'notes.txt'))).toEqual(Buffer.from([0xc4,0xfa,0xba,0xc3]));
  console.log('PASS modified GBK resources require saving and retain their encoding after save-and-compile');
  await node('value.h').click();await page.locator('.cm-content').fill('#define VALUE (0)\n');
  await expect.poll(async()=>(await compiled()).saved).toBe(false);
  await compile();expect(await readFile(path.join(dir,'value.h'),'utf8')).toContain('(0)');
  console.log('PASS dirty included headers still require save-and-compile with managed-output tabs open');
 }finally{
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(...args:any[])=>{const o=args.at(-1);return {response:Math.max(0,o.buttons.indexOf('不保存')),checkboxChecked:false};};}).catch(()=>{});
  await app.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
