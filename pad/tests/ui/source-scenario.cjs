const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
async function until(fn,label,timeout=150000){const started=Date.now();while(Date.now()-started<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timeout: '+label);}
async function runSourceScenario(electron,{executable,cwd,evidence}){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-source-')),data=path.join(temporary,'labpad'),errors=[],checks=[];
 await fs.mkdir(evidence,{recursive:true});
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page,menuCaptured=false;
 const state=()=>page.evaluate(()=>window.labpad.bootstrap()),button=name=>page.getByRole('button',{name,exact:true}),editor=()=>page.locator('.cm-content'),tabs=()=>page.getByRole('tab'),toolbar=()=>page.locator('.toolbar-actions');
 const printing=text=>'#include <stdio.h>\nint main(void){puts("'+text+'");return 0;}\n';
 function pass(text){checks.push(text);console.log('PASS '+text);}
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{globalThis.__files=[];globalThis.__answer=1;dialog.showOpenDialog=async()=>({canceled:!globalThis.__files.length,filePaths:globalThis.__files});dialog.showMessageBox=async()=>({response:globalThis.__answer,checkboxChecked:false});});
  await page.evaluate(()=>{window.__output='';window.labpad.onDebugData(text=>window.__output+=text);});
 }
 async function closeAll(){await tabs().first().click({button:'right'});await page.getByRole('menuitem',{name:'全部关闭',exact:true}).click();await until(()=>tabs().count().then(n=>n===0),'all tabs close');await page.locator('.editor-empty').waitFor();}
 async function create(language,empty=false,expected){
  const count=await tabs().count(),scope=empty?page.locator('.editor-empty'):toolbar();
  await scope.getByRole('button',{name:'新建源码',exact:true}).click();
  if(empty&&!menuCaptured){await page.screenshot({path:path.join(evidence,'new-source-menu.png'),fullPage:true});menuCaptured=true;}
  await page.getByRole('menuitem',{name:language==='c'?'C 源码（.c）':'C++ 源码（.cpp）',exact:true}).click();
  await until(()=>tabs().count().then(n=>n===count+1),'new source tab');await until(()=>button('导入').isEnabled(),'creation finishes');
  const loaded=await state();assert.equal(loaded.draft.language,language);assert.equal(path.extname(loaded.sourcePath),language==='c'?'.c':'.cpp');
  if(expected!==undefined)assert.equal(loaded.draft.source,expected);else assert.match(loaded.draft.source,language==='c'?/#include <stdio.h>/ : /#include <iostream>/);
  assert.equal(await fs.readFile(loaded.sourcePath,'utf8'),loaded.draft.source);return loaded;
 }
 async function save(){await editor().focus();await page.keyboard.press('Control+s');await until(()=>page.locator('.save-status').textContent().then(s=>s==='已保存'),'source saved');}
 async function run(expected){
  await page.evaluate(()=>window.__output='');await editor().focus();await page.keyboard.press('F9');
  await until(()=>page.evaluate(s=>window.__output.includes(s),expected),'actual '+expected);await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'run ends');
 }
 async function importFile(file){await app.evaluate((_,value)=>globalThis.__files=[value],file);await button('导入').click();await page.getByRole('menuitem',{name:'导入源码',exact:true}).click();await until(()=>button('导入').isEnabled(),'import finishes');}
 async function settings(mode){await page.getByRole('button',{name:/设置/}).click();await page.getByRole('combobox',{name:'保存方式',exact:true}).selectOption(mode);await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});}
 try{
  await prepare();assert.equal(await button('打开源码').count(),0);assert.equal(await button('导入源码').count(),0);
  assert.deepEqual((await toolbar().getByRole('button').allTextContents()).slice(0,2),['新建源码','导入']);
  await button('导入').click();assert.deepEqual(await page.getByRole('menuitem').allTextContents(),['导入源码','导入标准 I/O','导入实验项目']);await page.keyboard.press('Escape');
  pass('toolbar places New Source before Import; import menu contains source, standard I/O and project in the requested order');
  await closeAll();const c=await create('c',true);assert.equal(path.dirname(c.sourcePath),data);await editor().fill(printing('new-c'));await save();await run('new-c');
  const cSaved=await fs.readFile(c.sourcePath,'utf8');await closeAll();const cpp=await create('cpp',true);assert.equal(path.dirname(cpp.sourcePath),data);assert.notEqual(cpp.sourcePath,c.sourcePath);await editor().fill('#include <iostream>\nint main(){std::cout<<"new-cpp";}\n');await save();await run('new-cpp');assert.equal(await fs.readFile(c.sourcePath,'utf8'),cSaved);
  pass('empty editor creates physical C/C++ sources with matching templates, saves and runs both without overwriting prior versions');
  await closeAll();await page.locator('.editor-empty').getByRole('button',{name:'新建源码',exact:true}).focus();await page.keyboard.press('ArrowDown');await page.getByRole('menuitem',{name:'C 源码（.c）',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await tabs().count(),0);
  pass('new-source dropdown supports keyboard opening and cancellation without creating a file');
  const original=path.join(temporary,'outside.c'),originalCode=printing('original');await fs.writeFile(original,originalCode);await importFile(original);
  const copy=(await state()).sourcePath;assert.equal(path.dirname(copy),data);assert.notEqual(copy,original);await editor().fill(printing('copy-manual'));await save();assert.equal(await fs.readFile(original,'utf8'),originalCode);assert.match(await fs.readFile(copy,'utf8'),/copy-manual/);
  await settings('auto');await editor().fill(printing('copy-auto'));await until(()=>fs.readFile(copy,'utf8').then(t=>t.includes('copy-auto')),'automatic copy save');assert.equal(await fs.readFile(original,'utf8'),originalCode);await settings('manual');
  pass('scratch import always creates a managed copy; manual and automatic saves leave the original unchanged');
  await editor().fill(printing('unsaved-same-file'));const before=(await state()).draft.documentId,count=await tabs().count();await importFile(copy);assert.equal(await tabs().count(),count);assert.equal((await state()).draft.documentId,before);assert.match((await state()).draft.source,/unsaved-same-file/);
  await app.evaluate(()=>globalThis.__answer=2);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.waitForTimeout(150);assert.equal(page.isClosed(),false);assert.match((await state()).draft.source,/unsaved-same-file/);await save();assert.equal(await fs.readFile(original,'utf8'),originalCode);
  pass('importing an active owned file reuses the tab and preserves unsaved contents through a cancelled native close');
  const presetC=printing('course-template-c'),presetCpp='#include <iostream>\nint main(){std::cout<<"course-template-cpp";}\n',preset=path.join(temporary,'project.json');
  await fs.writeFile(preset,JSON.stringify({schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[{problemId:'Lab 2-1',language:'c',source:presetC,testCases:[]},{problemId:'Lab 2-2',language:'cpp',source:presetCpp,testCases:[]}]}));await app.evaluate((_,file)=>globalThis.__files=[file],preset);await button('导入').click();await page.getByRole('menuitem',{name:'导入实验项目',exact:true}).click();await until(()=>page.getByRole('combobox',{name:'实验项目',exact:true}).inputValue().then(v=>v==='实验2'),'project imported');
  await editor().fill(printing('unsaved-current'));const previous=(await state()).draft.documentId;const fresh=await create('c',false,presetC);assert.notEqual(fresh.draft.documentId,previous);
  await tabs().first().click();assert.match((await state()).draft.source,/unsaved-current/);assert.equal(await page.locator('.save-status').textContent(),'未保存');await app.evaluate(()=>globalThis.__answer=1);await closeAll();
  pass('toolbar New Source uses the course template and preserves the previous unsaved tab');
  for(const language of ['c','cpp']){const doc=await create(language,true,language==='c'?presetC:undefined);assert.equal(path.dirname(doc.sourcePath),path.join(data,'projects','实验2'));assert.equal(doc.draft.problem.problemId,'Lab 2-1');await closeAll();}
  await page.getByRole('combobox',{name:'题号',exact:true}).selectOption('Lab 2-2');await until(()=>editor().count().then(n=>n===1),'C++ problem selected');await closeAll();const reopened=await create('cpp',true,presetCpp);
  pass('new sources use per-topic C/C++ presets, default the other language and stay in the matching project directory');
  await save();await page.screenshot({path:path.join(evidence,'new-source.png'),fullPage:true});await app.close();app=await launch();await prepare();
  assert.ok((await state()).documents.some(d=>d.documentId===reopened.draft.documentId));assert.equal((await state()).config.sourceFile,null);assert.deepEqual(errors,[]);
  pass('new sources and unified-import settings restore after restart; no renderer errors');await fs.writeFile(path.join(evidence,'source-checks.json'),JSON.stringify({platform:process.platform,checks},null,2));
 }catch(e){if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'source-failure.png'),fullPage:true}).catch(()=>{});}throw e;}
 finally{await app.evaluate(()=>globalThis.__answer=1).catch(()=>{});await app.close().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={runSourceScenario};
if(require.main===module){const {_electron}=require('playwright');runSourceScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});}
