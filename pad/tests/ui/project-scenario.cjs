const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
async function until(fn,label,timeout=30000){
 const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw new Error('Timeout: '+label);
}
async function runProjectScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-project-中文-')),data=path.join(temporary,'labpad'),errors=[],checks=[];
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page;
 const button=name=>page.getByRole('button',{name,exact:true}),input=name=>page.getByRole('textbox',{name,exact:true}),select=name=>page.getByRole('combobox',{name,exact:true});
 const state=()=>page.evaluate(()=>window.labpad.bootstrap());
 const editor=()=>page.locator('.cm-content');
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{
   globalThis.__files=[];globalThis.__warnings=[];globalThis.__saveNames=[];globalThis.__saveTarget='';globalThis.__exportAnswer=0;globalThis.__copyAnswer=0;
   dialog.showOpenDialog=async()=>({canceled:!globalThis.__files.length,filePaths:globalThis.__files});
   dialog.showMessageBox=async(...args)=>{
    const options=args.at(-1);globalThis.__warnings.push(options);
    if(options.title==='导出前请确认'){
     const response=globalThis.__holdWarning?await new Promise(resolve=>globalThis.__resolveWarning=resolve):globalThis.__exportAnswer;
     return {response,checkboxChecked:false};
    }
    return {response:options.title==='导入项目副本'?globalThis.__copyAnswer:1,checkboxChecked:false};
   };
   dialog.showSaveDialog=async(...args)=>{globalThis.__saveNames.push(args.at(-1).defaultPath);return {canceled:!globalThis.__saveTarget,filePath:globalThis.__saveTarget};};
  });
 }
 async function files(values){await app.evaluate((_,v)=>globalThis.__files=v,values);}
 async function chooseMenu(label,item){await button(label).click();await page.getByRole('menuitem',{name:item,exact:true}).click();}
 async function idle(){await until(()=>button('导出').isEnabled(),'file operation completes');}
 async function warning(){return app.evaluate(()=>globalThis.__warnings.at(-1));}
 async function setAnswer(response){await app.evaluate((_,v)=>globalThis.__exportAnswer=v,response);}
 async function target(name){const file=path.join(temporary,name);await app.evaluate((_,v)=>globalThis.__saveTarget=v,file);return file;}
 async function settings(){await page.getByRole('button',{name:/设置/}).click();await page.getByRole('dialog').waitFor();}
 async function apply(){await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});}
 async function changeTopic(name){await select('题号').selectOption(name);await until(()=>select('题号').inputValue().then(v=>v===name),'topic selected');}
 async function projectJSON(value,name='project.json'){const file=path.join(temporary,name);await fs.writeFile(file,JSON.stringify(value,null,2));await files([file]);return file;}
 async function archive(file){
  const zlib=require('node:zlib'),bytes=await fs.readFile(file),result={};let at=0;
  while(bytes.readUInt32LE(at)===0x04034b50){
   const method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),nameLength=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+nameLength).toString('utf8');
   const dataAt=at+30+nameLength+extra,body=bytes.subarray(dataAt,dataAt+size);result[name]=(method===8?zlib.inflateRawSync(body):body).toString('utf8');at=dataAt+size;
  }
  return result;
 }
 const printing=n=>'#include <stdio.h>\nint main(void) { puts("'+n+'"); return 0; }\n';
 const value={schemaVersion:1,kind:'labpad.project',labId:'实验2',problems:[
  {problemId:'warmup 2-1',source:printing('starter').trimEnd().split('\n'),testCases:[{id:'1',input:'',expectedOutput:'starter\n'}]},
  {problemId:'Lab 2-1',language:'cpp',source:'#include <iostream>\nint main() { std::cout << 9; }\n',testCases:[{id:'1',input:'',expectedOutput:'9'}]},
  {problemId:'Lab 2-2',source:printing(2),testCases:[]}
 ]};
 function pass(label){checks.push(label);console.log('PASS '+label);}
 try{
  await prepare();
  if(process.platform!=='darwin'){
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMenuBarVisible()),false);
   await page.keyboard.press('Alt');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMenuBarVisible()),false);
  }
  await settings();assert.equal(await input('班号').getAttribute('placeholder'),'例如 9527');assert.equal(await input('姓名').getAttribute('placeholder'),'例如 马冬梅');assert.equal(await input('学号').getAttribute('placeholder'),'例如 7355608');
  for(const name of ['班号','姓名','学号'])assert.equal(await input(name).inputValue(),'');
  assert.equal(await page.getByText('本地保存 · 无需账号',{exact:true}).count(),0);
  await page.getByRole('checkbox',{name:'保存时自动格式化',exact:true}).uncheck();await apply();
  assert.equal(await page.locator('footer').locator(':scope > *').count(),2);assert.equal(await page.locator('footer .compiler-label,footer .status-folder,footer .status-save').count(),0);
  pass('Windows/Linux menu bar stays hidden; identity examples are placeholders; settings and footer have no redundant labels');
  await button('导入').focus();await page.keyboard.press('ArrowDown');await page.getByRole('menuitem',{name:'导入标准 I/O',exact:true}).waitFor();await page.keyboard.press('Escape');
  await until(()=>page.getByRole('menuitem').count().then(n=>n===0),'Escape dismisses menu');assert.equal(await button('导入').evaluate(e=>e===document.activeElement),true);
  await button('导出').click();const outside=await page.locator('.brandbar').boundingBox();await page.mouse.click(outside.x+20,outside.y+20);await until(()=>page.getByRole('menuitem').count().then(n=>n===0),'outside click dismisses menu');
  for(const name of ['导入','导出']){
   const trigger=button(name),arrow=trigger.locator('svg'),box=await trigger.boundingBox(),icon=await arrow.boundingBox();
   assert.ok(icon.width>=14&&icon.height>=14);assert.ok(Math.abs((icon.y+icon.height/2)-(box.y+box.height/2))<=1);
   const size=await trigger.evaluate(e=>getComputedStyle(e).fontSize);assert.equal(size,await button('打开源码').evaluate(e=>getComputedStyle(e).fontSize));
  }
  await page.locator('.toolbar-actions').screenshot({path:path.join(evidence,'menu-arrows.png')});
  pass('native dropdown keyboard opening, Escape, focus return, outside dismissal and centered 14px arrows with matching text size');
  await projectJSON(value);await button('导入').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await until(()=>select('实验项目').inputValue().then(v=>v==='实验2'),'keyboard project import');await idle();
  assert.equal((await state()).draft.problem.problemId,'warmup 2-1');assert.equal((await state()).draft.source,printing('starter'));
  assert.deepEqual((await state()).projects,[{labId:'实验2',problems:['warmup 2-1','Lab 2-1','Lab 2-2']}]);
  await changeTopic('Lab 2-1');assert.equal((await state()).draft.language,'cpp');assert.match((await state()).draft.source,/iostream/);
  await changeTopic('warmup 2-1');assert.equal((await state()).draft.language,'c');
  pass('project JSON imports presets, tests and ordered problem names; topic selection restores C/C++ independently');
  const saveCount=await app.evaluate(()=>globalThis.__saveNames.length);await chooseMenu('导出','导出实验项目');await idle();
  const options=await warning();assert.equal(options.title,'导出前请确认');assert.deepEqual(options.buttons,['取消导出','仍然导出']);assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);
  assert.match(options.detail,/未编辑源码：warmup 2-1、Lab 2-1、Lab 2-2/);assert.match(options.detail,/尚未测试/);assert.match(options.detail,/未设置测试点/);assert.match(options.detail,/班号、姓名、学号/);
  assert.equal(await app.evaluate(()=>globalThis.__saveNames.length),saveCount);
  await setAnswer(1);const missing=await target('without-identity.zip');await chooseMenu('导出','导出实验项目');await until(()=>fs.stat(missing).then(()=>true,()=>false),'forced project export');await idle();
  assert.equal(await app.evaluate(()=>globalThis.__saveNames.at(-1)),'未填班号_未填姓名_未填学号_实验2.zip');
  assert.deepEqual(Object.keys(await archive(missing)),['未填班号_未填姓名_未填学号_实验2/warmup 2-1.c','未填班号_未填姓名_未填学号_实验2/Lab 2-1.cpp','未填班号_未填姓名_未填学号_实验2/Lab 2-2.c']);
  pass('export preflight points to unedited/unverified topics and missing identity; cancellation stops before save dialog; force exports source-only ZIP');
  await settings();await input('班号').fill('240101');await input('姓名').fill('张三');await input('学号').fill('12345678');await apply();
  const changed='// student edit, not yet saved\n'+printing('starter');await editor().fill(changed);
  await page.getByRole('button',{name:/编译并运行/}).click();await page.locator('.verdict.ac').waitFor({timeout:150000});await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'judge persistence completes');
  await fs.access(path.join(data,'projects','实验2','.labpad'));
  const beforeWarnings=await app.evaluate(()=>globalThis.__warnings.length),source=await target('source.c');
  await chooseMenu('导出','导出源码');await until(()=>fs.stat(source).then(()=>true,()=>false),'accepted source export');await idle();
  assert.equal(await fs.readFile(source,'utf8'),changed);assert.equal(await app.evaluate(()=>globalThis.__warnings.length),beforeWarnings);
  assert.equal(await app.evaluate(()=>globalThis.__saveNames.at(-1)),'12345678_warmup 2-1.c');
  assert.equal(await fs.readFile(path.join(data,'projects','实验2','warmup 2-1.c'),'utf8'),printing('starter'));
  await editor().fill(changed+'// changed again\n');await setAnswer(0);await chooseMenu('导出','导出源码');await idle();assert.match((await warning()).detail,/需重新测试/);
  pass('export uses unsaved editor contents without saving; current accepted result suppresses warning, later edits invalidate it');
  const before=await state();const io={schemaVersion:1,labId:'foreign',problemId:'foreign',title:'foreign',testCases:[{id:'x',input:'',expectedOutput:'starter'}]};
  await projectJSON(io,'io.json');await chooseMenu('导入','导入标准 I/O');await idle();
  const after=await state();assert.equal(after.draft.problem.labId,'实验2');assert.equal(after.draft.problem.problemId,'warmup 2-1');assert.equal(after.draft.source,before.draft.source);assert.equal(after.draft.problem.testCases[0].id,'x');
  assert.equal(await page.locator('.save-status').textContent(),'未保存');
  await projectJSON(value,'wrong-io.json');await chooseMenu('导入','导入标准 I/O');await idle();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').textContent(),/导入实验项目/);await button('关闭').click();
  assert.equal((await state()).draft.problem.testCases[0].id,'x');
  pass('standard I/O import stays in current topic, preserves unsaved source and rejects a project JSON without mutation');
  await projectJSON(value);await chooseMenu('导入','导入实验项目');await idle();assert.equal((await state()).projects.length,1);
  await app.evaluate(()=>globalThis.__copyAnswer=1);await chooseMenu('导入','导入实验项目');await idle();assert.equal((await state()).draft.problem.labId,'实验2 (2)');assert.equal((await state()).projects.length,2);
  assert.equal(JSON.parse(await fs.readFile(path.join(data,'projects','实验2','warmup 2-1.json'),'utf8')).testCases[0].id,'x');
  const invalid={...value,labId:'bad',problems:[{problemId:'valid'},{problemId:'../invalid'}]};await projectJSON(invalid,'invalid.json');await chooseMenu('导入','导入实验项目');await idle();await page.getByRole('alert').waitFor();assert.equal((await state()).projects.length,2);
  assert.ok(!(await fs.readdir(data)).some(n=>n.startsWith('.import-')));await button('关闭').click();
  pass('same-name import cancels or creates a separate copy; invalid projects never appear partially');
  await select('实验项目').selectOption('实验2');await until(()=>select('实验项目').inputValue().then(v=>v==='实验2'),'return to original');await idle();
  await changeTopic('Lab 2-1');
  const external=path.join(temporary,'external.cpp');await fs.writeFile(external,'// external before dialog\nint main(){return 0;}\n');await files([external]);await button('打开源码').click();await idle();
  const packagePath=await target('submission.zip');await setAnswer(1);await app.evaluate(()=>globalThis.__holdWarning=true);
  await chooseMenu('导出','导出实验项目');await until(()=>app.evaluate(()=>typeof globalThis.__resolveWarning==='function'),'preflight is waiting');
  assert.equal(await button('打开源码').isDisabled(),true);assert.equal(await select('题号').isDisabled(),true);assert.equal(await editor().getAttribute('contenteditable'),'false');
  await fs.writeFile(external,'// external changed during review\nint main(){return 1;}\n');
  await app.evaluate(()=>{globalThis.__holdWarning=false;globalThis.__resolveWarning(1);});await until(()=>fs.stat(packagePath).then(()=>true,()=>false),'atomic snapshot ZIP');await idle();
  const contents=await archive(packagePath),prefix='240101_张三_12345678_实验2/';
  assert.deepEqual(Object.keys(contents),[prefix+'12345678_warmup 2-1.c',prefix+'12345678_Lab 2-1.cpp',prefix+'12345678_Lab 2-2.c']);
  assert.match(contents[prefix+'12345678_Lab 2-1.cpp'],/external before dialog/);assert.equal(await app.evaluate(()=>globalThis.__saveNames.at(-1)),'240101_张三_12345678_实验2.zip');
  await changeTopic('warmup 2-1');await changeTopic('Lab 2-1');assert.match((await state()).draft.source,/external changed during review/);
  pass('project archive matches specified root and names; preflight freezes export contents and blocks overlapping edits; per-topic external links reopen correctly');
  await app.evaluate(()=>globalThis.__saveTarget='');await chooseMenu('导出','导出实验项目');await idle();assert.deepEqual(await archive(packagePath),contents);
  if(process.platform==='linux'||process.platform==='win32'){
   if(process.platform==='linux')await fs.chmod(temporary,0o500);else await fs.chmod(packagePath,0o444);await app.evaluate((_,v)=>globalThis.__saveTarget=v,packagePath);await chooseMenu('导出','导出实验项目');await idle();
   await page.getByRole('alert').waitFor();assert.deepEqual(await archive(packagePath),contents);await fs.chmod(temporary,0o700);await fs.chmod(packagePath,0o600);await button('关闭').click();
  }
  await page.screenshot({path:path.join(evidence,'project-export.png'),fullPage:true});
  assert.deepEqual(errors,[]);await app.close();app=await launch();await prepare();
  assert.equal((await state()).draft.language,'cpp');assert.match((await state()).draft.source,/external changed during review/);
  assert.equal((await state()).projects.length,2);assert.equal((await state()).config.studentId,'12345678');
  pass('save-dialog cancellation and failed archive replacement preserve prior ZIP; project metadata and external links survive restart');
  console.log('ALL PROJECT CHECKS PASSED ('+checks.length+' groups)');
 }catch(error){
  if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'project-failure.png'),fullPage:true}).catch(()=>{});}throw error;
 }finally{
  await fs.chmod(temporary,0o700).catch(()=>{});await app.close().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});
 }
}
module.exports={runProjectScenario};
if(require.main===module){const {_electron}=require('playwright');runProjectScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});}
