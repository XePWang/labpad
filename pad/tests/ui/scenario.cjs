const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {clipboardGuard}=require('./editor-scenario.cjs');
async function until(fn,label,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timeout: '+label);}
async function runScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-workspace-中文-')),data=path.join(temporary,'labpad'),errors=[],checks=[];
 const restore=await clipboardGuard('LabPad-workspace-clipboard');
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page;
 const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('textbox',{name,exact:true}),select=name=>name==='题号'?require('./selectors.cjs').topic(page):page.getByRole('combobox',{name,exact:true});
 const state=()=>page.evaluate(()=>window.labpad.bootstrap()),editor=()=>page.locator('.cm-content');
 const edit=source=>editor().fill(source);
 const equal=(source,label)=>until(async()=>(await state()).draft.source===source,label);
 const code=n=>'#include <stdio.h>\nint main(void){puts("'+n+'");return 0;}\n';
 const names=()=>page.getByRole('tab').allTextContents();
 const tabs=()=>page.getByRole('tab');
 async function ready(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{
   globalThis.__files=[];globalThis.__answer=2;globalThis.__warnings=[];
   dialog.showOpenDialog=async()=>({canceled:!globalThis.__files.length,filePaths:globalThis.__files});
   dialog.showMessageBox=async(...args)=>{globalThis.__warnings.push(args.at(-1));return {response:globalThis.__answer,checkboxChecked:false};};
  });
  await page.evaluate(()=>{window.__output='';window.__compiles=[];window.labpad.onDebugData(data=>window.__output+=data);window.labpad.onJudge(e=>{if(e.type==='compilation')window.__compiles.push(e.compilation);});});
 }
 async function files(paths){await app.evaluate((_,v)=>globalThis.__files=v,paths);}
 async function answer(value){await app.evaluate((_,v)=>globalThis.__answer=v,value);}
 async function settings(){await page.getByRole('button',{name:/设置/}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor();}
 async function apply(){await button('保存设置').click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'});}
 async function save(all=false){await button('保存').click();await page.getByRole('menuitem',{name:all?'保存全部':'保存当前',exact:true}).click();await until(()=>page.locator('.save-status').textContent().then(v=>v==='已保存'),'saved');}
 async function context(item,index){await tabs().nth(index??(await tabs().count()-1)).click({button:'right'});await page.getByRole('menuitem',{name:item,exact:true}).click();}
 async function idle(){await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'run finished',150000);}
 async function output(text){await until(()=>page.evaluate(t=>window.__output.includes(t),text),'terminal '+text,150000);}
 async function importSource(){await button('导入').click();await page.getByRole('menuitem',{name:'导入源码',exact:true}).click();}
 function pass(label){checks.push(label);console.log('PASS '+label);}
 async function create(lab,problem){
  if(lab){await select('实验项目').selectOption('@new:lab');await input('项目名称').fill(lab);await button('新建').click();await until(()=>select('实验项目').inputValue().then(v=>v===lab),'created lab');}
  if(problem){await select('题号').selectOption('@new:problem');await input('新题号').fill(problem);await button('新建').click();await until(()=>select('题号').inputValue().then(v=>v===problem),'created topic');}
 }
 try{
  await ready();await settings();await page.getByRole('checkbox',{name:'保存时自动格式化'}).uncheck();await apply();
  const original=path.join(temporary,'原始.c');await fs.writeFile(original,code('original'));await files([original]);await importSource();await equal(code('original'),'external opened');
  await edit(code('changed'));await save();assert.equal(await fs.readFile(original,'utf8'),code('original'));
  await edit(code('carried'));await answer(1);await create('实验2','Lab 2-1');await equal(code('carried'),'creating project carries code');assert.equal(await fs.readFile(original,'utf8'),code('original'));await save();
  assert.equal(await button('导入源码').count(),0);pass('scratch imports a managed copy without changing original; creating a project and first topic preserves unsaved code');
  const imported=path.join(temporary,'导入版本.cpp');await fs.writeFile(imported,'#include <iostream>\nint main(){std::cout<<"中文";}\n');await files([imported]);const count=await tabs().count();await importSource();await until(()=>tabs().count().then(n=>n===count+1),'import creates a tab');
  const importedPath=(await state()).sourcePath;assert.notEqual(importedPath,imported);await edit('// managed edit\n'+await fs.readFile(imported,'utf8'));await save();assert.ok(!(await fs.readFile(imported,'utf8')).includes('managed edit'));assert.match(await fs.readFile(importedPath,'utf8'),/managed edit/);
  await files([importedPath]);await importSource();await until(()=>button('导入').isEnabled(),'same owned import completes');assert.equal(await tabs().count(),count+1);pass('project import copies C/C++ source, saves managed version and reopens same-topic file without duplication');
  const first=(await names())[0];await tabs().nth(0).click();await edit(code('first')+'// first unsaved\n');await editor().focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('AAA');
  const firstText=(await state()).draft.source;await tabs().nth(1).click();const secondBefore=(await state()).draft.source;await editor().focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('BBB');await page.keyboard.press('Control+z');await equal(secondBefore,'second undo independent');await page.keyboard.press('Control+Shift+Z');await equal(secondBefore+'BBB','second redo independent');
  await tabs().nth(0).click();await equal(firstText,'first contents retained');await page.keyboard.press('Control+z');await equal(firstText.slice(0,-3),'first undo history retained');await page.keyboard.press('Control+Shift+Z');await equal(firstText,'first redo retained');
  await save(true);for(const tab of (await state()).documents){if(tab.sourceFile&&tab.documentId===(await state()).draft.documentId)assert.equal(await fs.readFile(tab.sourceFile,'utf8'),firstText);}
  assert.equal(await page.locator('.tab-dirty').count(),0);pass('tabs retain independent text, caret and native undo/redo; Save All saves every open file');
  await context('另存为新版本',0);await until(()=>tabs().count().then(n=>n===count+2),'new version tab');await edit(code('v3'));await save();
  await page.keyboard.press('Control+Tab');await page.keyboard.press('Control+Shift+Tab');
  await context('复制路径');const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.equal(copied,(await state()).sourcePath);
  await context('复制相对路径');assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),path.relative(data,copied));
  const versionPath=(await state()).sourcePath;await edit(code('dirty'));await answer(2);await context('关闭');assert.equal(await tabs().count(),count+2);
  await answer(1);await context('关闭');await until(()=>tabs().count().then(n=>n===count+1),'discard closes tab');assert.equal(await fs.readFile(versionPath,'utf8'),code('v3'));pass('version creation, next/previous tabs, copy paths and close cancel/discard preserve saved versions');
  await context('关闭其他',0);await until(()=>tabs().count().then(n=>n===1),'close others');
  for(let n=0;n<6;n++){await context('另存为新版本',0);await edit(code('version '+n));await save();await page.waitForTimeout(15);}
  const allFiles=await fs.readdir(path.join(data,'projects','实验2')),allSources=allFiles.filter(n=>/\.(c|cpp)$/.test(n));assert.ok(allSources.length>=7);
  await create(null,'Lab 2-2');await files([versionPath]);await importSource();await until(()=>button('导入').isEnabled(),'foreign import complete');const foreignPath=(await state()).sourcePath;assert.notEqual(foreignPath,versionPath);
  await select('题号').selectOption('Lab 2-1');await until(()=>tabs().count().then(n=>n===5),'latest five reopened');assert.equal(await select('题号').inputValue(),'Lab 2-1');
  await files([versionPath]);await importSource();await until(()=>button('导入').isEnabled(),'old managed version opens');
  assert.ok((await names()).some(n=>n.includes(path.basename(versionPath))));assert.deepEqual((await fs.readdir(path.join(data,'projects','实验2'))).filter(n=>/\.(c|cpp)$/.test(n)).sort(),[...allSources,'Lab 2-2.c',path.basename(foreignPath)].sort());
  pass('switching topics reopens latest five versions, retains all files, copies foreign-topic source and allows older versions to open');
  await answer(1);await context('全部关闭');await until(()=>tabs().count().then(n=>n===0),'all closed');assert.equal(await editor().count(),0);assert.equal(await page.getByRole('button',{name:/编译并运行/}).isDisabled(),true);
  await files([versionPath]);await importSource();await until(()=>tabs().count().then(n=>n===1),'reopen after close all');pass('close all leaves a clean empty editor and reopening a version restores it');
  // UTF-8 PTY: narrow stdio, split byte writes, stderr, input and emoji.
  const interactive='#include <stdio.h>\nint main(void){char line[256];fputs("你好 good evening.\\n",stdout);fputs("错误输出\\n",stderr);fflush(NULL);if(fgets(line,sizeof line,stdin)){printf("收到:%s",line);fflush(stdout);}return 0;}\n';
  await edit(interactive);await page.evaluate(()=>window.__output='');await editor().focus();await page.keyboard.press('F9');await output('你好 good evening.');await output('错误输出');
  await page.getByRole('textbox',{name:'调试输入',exact:true}).focus();await page.keyboard.insertText('中文输入');await page.keyboard.press('Enter');await output('收到:中文输入');await idle();
  const split='#include <stdio.h>\nint main(void){unsigned char s[]={0xE4,0xBD,0xA0,0xE5,0xA5,0xBD,0xF0,0x9F,0x98,0x80,0};for(int i=0;s[i];i++){putchar(s[i]);fflush(stdout);}return 0;}\n';
  await edit(split);await page.evaluate(()=>window.__output='');await page.keyboard.press('Control+Enter');await output('你好😀');await idle();
  assert.ok(!(await page.evaluate(()=>window.__output)).includes('\uFFFD'));pass('F9 / Ctrl+Enter compile and debug Chinese stdin/stdout/stderr, split UTF-8 bytes and emoji without garbling');
  for(const [name,bytes,expected] of [
   ['编码.cpp',Buffer.from('#include <iostream>\nint main(){std::cout<<"你好 C++ 😀"<<std::endl;std::cerr<<"错误 C++"<<std::endl;}','utf8'),'你好 C++ 😀'],
   ['GBK.c',Buffer.concat([Buffer.from('#include <stdio.h>\nint main(void){puts("'),Buffer.from([0xc4,0xe3,0xba,0xc3]),Buffer.from(' GBK");return 0;}\n')]),'你好 GBK'],
   ['UTF16.c',Buffer.concat([Buffer.from([255,254]),Buffer.from('#include <stdio.h>\nint main(void){puts("你好 UTF16");return 0;}\n','utf16le')]),'你好 UTF16']
  ]){
   const file=path.join(temporary,name);await fs.writeFile(file,bytes);await files([file]);await importSource();await until(()=>button('导入').isEnabled(),'encoded source imported');
   await page.evaluate(()=>window.__output='');await page.keyboard.press('F9');await output(expected);await idle();assert.deepEqual(await fs.readFile(file),bytes);
  }
  pass('real C++ Unicode output and GBK / UTF-16 imports compile as UTF-8 while originals retain exact bytes');
  const flood='#include <stdio.h>\nint main(void){for(int i=0;i<12000;i++)printf("行%d 你好\\n",i);puts("END-中文");return 0;}\n';await edit(flood);await page.evaluate(()=>window.__output='');await page.keyboard.press('F9');await output('END-中文');await idle();
  assert.equal((await page.evaluate(()=>window.__output.match(/你好/g)?.length)),12000);pass('large terminal output drains without truncation or Unicode replacement');
  await edit('#include <stdio.h>\nint main(void){puts("等待输入");fflush(stdout);for(;;){}return 0;}\n');await page.keyboard.press('F9');await output('等待输入');await page.getByRole('textbox',{name:'调试输入',exact:true}).focus();await page.keyboard.press('Control+c');await until(()=>page.locator('.phase').textContent().then(t=>t.includes('停止')),'Ctrl C interrupts');pass('terminal Ctrl+C stops process tree');
  await edit('invalid syntax');await page.keyboard.press('F9');await idle();assert.match(await button('输出').getAttribute('class'),/active/);
  await edit(code('3.0'));await page.getByRole('button',{name:/新增测试点/}).click();await input('预期输出 1').fill('3.00');await save();
  const rules=path.join(data,'projects','实验2','Lab 2-1.json'),problem=JSON.parse(await fs.readFile(rules,'utf8'));problem.testCases.push({id:'float',input:'',expectedOutput:'3.00',comparison:{type:'floatTokens',absoluteTolerance:0}});await fs.writeFile(rules,JSON.stringify(problem));
  await button('重新加载').click();await until(()=>button('导入').isEnabled(),'reload complete');await page.keyboard.press('F9');await page.locator('.verdict.wa').waitFor();await page.locator('.verdict.ac').waitFor();await idle();pass('CE stays in Output; one topic uses exact and floating checkers together');
  await settings();await button('设置快捷键…').click();await until(()=>app.windows().length===2,'shortcut window opens');const popup=app.windows().find(w=>w!==page);await popup.getByRole('heading',{name:'快捷键',exact:true}).waitFor();
  await popup.getByRole('textbox',{name:'编译并运行 快捷键',exact:true}).fill('F8');await popup.getByRole('button',{name:'保存快捷键',exact:true}).click();await until(()=>popup.getByRole('status').textContent().then(t=>t.includes('已保存')),'shortcut change saves');
  await popup.getByRole('textbox',{name:'保存当前 快捷键',exact:true}).fill('F8');await popup.getByRole('button',{name:'保存快捷键',exact:true}).click();await popup.getByRole('alert').waitFor();assert.match(await popup.getByRole('alert').textContent(),/重复/);
  await popup.close();await button('取消').click();await page.keyboard.press('F8');await page.locator('.verdict.ac').waitFor();await idle();assert.deepEqual((await state()).config.shortcuts.run,['F8']);pass('separate shortcut window applies custom bindings immediately and rejects conflicts');
  await settings();await select('界面缩放').selectOption('1.25');await apply();assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),1.25);
  await settings();await button('清理编译缓存').click();await until(()=>page.locator('.cache-controls').textContent().then(t=>t.includes('已清理')),'cache cleared');assert.ok((await fs.readdir(path.join(data,'projects','实验2'))).includes(path.basename(versionPath)));await select('界面缩放').selectOption('1');await apply();pass('native UI zoom persists and cache clearing preserves sources and rules');
  await answer(0);await save();await app.close();app=await launch();await ready();assert.deepEqual((await state()).config.shortcuts.run,['F8']);assert.equal((await state()).config.zoomFactor,1);assert.ok((await state()).draft.source.includes('3.0'));assert.equal(await tabs().count(),5);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(evidence,'workspace-final.png'),fullPage:true});
  await fs.writeFile(path.join(evidence,'workspace-checks.json'),JSON.stringify({platform:process.platform,checks},null,2));pass('versions, custom shortcuts and settings survive restart; no renderer errors');
  console.log('ALL WORKSPACE CHECKS PASSED ('+checks.length+' groups)');
 }catch(error){for(const opened of app.windows())if(opened!==page&&!opened.isClosed())console.error(await opened.locator('body').innerText());if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'workspace-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
 finally{await app.evaluate(()=>globalThis.__answer=1).catch(()=>{});await app.close().catch(()=>{});await restore();await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={runScenario};
if(require.main===module){const {_electron}=require('playwright');runScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});}
