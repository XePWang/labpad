const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
async function until(fn,label,timeout=150000){
 const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timeout: '+label);
}
async function runScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-中文-'));
 const data=path.join(temporary,'portable','labpad'),errors=[],times=[];
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page;
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{
   globalThis.__files=[];globalThis.__nextAnswer=2;globalThis.__saveFile='';globalThis.__saveNames=[];
   dialog.showMessageBox=async()=>({response:globalThis.__nextAnswer,checkboxChecked:false});
   dialog.showOpenDialog=async()=>({canceled:!globalThis.__files.length,filePaths:globalThis.__files});
   dialog.showSaveDialog=async(...args)=>{globalThis.__saveNames.push(args.at(-1).defaultPath);return{canceled:false,filePath:globalThis.__saveFile};};
  });
  await page.evaluate(()=>{window.__debug=[];window.__compiles=[];window.labpad.onDebugData(d=>window.__debug.push(d));window.labpad.onJudge(e=>{if(e.type==='compilation')window.__compiles.push(e.compilation);});});
 }
 const button=name=>page.getByRole('button',{name,exact:true});
 const input=name=>page.getByRole('textbox',{name,exact:true});
 const select=name=>page.getByRole('combobox',{name,exact:true});
 const edit=source=>page.locator('.cm-content').fill(source);
 const run=()=>page.getByRole('button',{name:/编译并运行/}).click();
 async function saved(){await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'document saved');}
 async function save(){await button('保存').click();await saved();}
 async function settings(){await page.getByRole('button',{name:/设置/}).click();await page.getByRole('dialog').waitFor();}
 async function apply(){await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});}
 async function files(paths){await app.evaluate((_,p)=>{globalThis.__files=p;},paths);}
 async function exportFile(expected){
  const target=path.join(temporary,expected);await app.evaluate((_,file)=>{globalThis.__saveFile=file;},target);
  await page.getByRole('button',{name:/导出源码/}).click();await until(()=>fs.stat(target).then(()=>true,()=>false),'export file');
  assert.equal(await app.evaluate(()=>globalThis.__saveNames.at(-1)),expected);return target;
 }
 const printing=n=>'#include <stdio.h>\nint main(void){puts("'+n+'");return 0;}\n';
 try{
  await prepare();assert.equal(await page.title(),'LabPad');assert.equal(await app.evaluate(({app})=>app.getName()),'LabPad');
  assert.equal(await select('实验项目').inputValue(),'');assert.equal(await select('题号').inputValue(),'');
  assert.equal(await page.locator('.toolbar input').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal((await page.evaluate(()=>window.labpad.bootstrap())).config.saveMode,'manual');
  assert.equal((await page.evaluate(()=>window.labpad.bootstrap())).config.formatOnSave,true);
  await settings();await page.getByRole('checkbox',{name:'保存时自动格式化'}).uncheck();await apply();
  await exportFile('空项目.c');
  await settings();await select('源码语言').selectOption('cpp');await apply();await exportFile('空项目.cpp');
  await settings();await select('源码语言').selectOption('c');await apply();
  console.log('PASS empty project selectors, optional identity and C/C++ export names');

  await edit('invalid C syntax\n');await run();
  await until(()=>page.locator('.phase').textContent().then(t=>t.includes('失败')),'compile failure');
  assert.match(await button('输出').getAttribute('class'),/active/);
  const debugSource='#include <stdio.h>\nint main(void){int n;printf("number: ");fflush(stdout);scanf("%d",&n);printf("answer: %d\\n",n*2);fflush(stdout);scanf("%d",&n);return 0;}\n';
  await edit(debugSource);await run();
  await until(()=>page.locator('.phase').textContent().then(t=>t.includes('调试运行中')),'automatic debug');
  assert.match(await button('调试').getAttribute('class'),/active/);
  await until(()=>page.evaluate(()=>window.__debug.join('').includes('number:')),'debug prompt');
  await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('7');await page.keyboard.press('Enter');
  await until(()=>page.evaluate(()=>window.__debug.join('').includes('answer: 14')),'interactive input');
  await button('输出').click();await page.waitForTimeout(1200);
  assert.match(await page.locator('.phase').textContent(),/调试运行中/);await button('调试').click();
  await page.screenshot({path:path.join(evidence,'desktop-debug.png'),fullPage:true});
  await page.getByRole('button',{name:/停止程序/}).click();await until(()=>page.locator('.phase').textContent().then(t=>t.includes('已停止')),'stop');
  await assert.rejects(fs.stat(path.join(data,'空项目.c')));
  await save();assert.equal(await fs.readFile(path.join(data,'空项目.c'),'utf8'),debugSource);
  console.log('PASS no-case compilation enters debug, CE stays in Output, manual mode does not save on run');

  await select('实验项目').selectOption('@new:lab');await input('项目名称').fill('Lab 2');await button('新建').click();
  await until(()=>select('实验项目').inputValue().then(v=>v==='Lab 2'),'new project');assert.equal(await select('题号').inputValue(),'');
  await select('题号').selectOption('@new:problem');await input('新题号').fill('Lab 2-1');await button('新建').click();
  await until(()=>select('题号').inputValue().then(v=>v==='Lab 2-1'),'new problem');
  const managed=path.join(data,'projects','Lab 2','Lab 2-1.c'),initial=await fs.readFile(managed,'utf8');
  await edit(printing(42));await page.getByRole('button',{name:/新增测试点/}).click();await input('预期输出 1').fill('42');
  await run();await page.locator('.verdict.ac').waitFor({timeout:150000});assert.equal(await fs.readFile(managed,'utf8'),initial);
  await select('实验项目').selectOption('');await page.waitForTimeout(200);assert.equal(await select('实验项目').inputValue(),'Lab 2');
  await save();assert.equal(await fs.readFile(managed,'utf8'),printing(42));
  await input('预期输出 1').fill('43');await run();await page.locator('.verdict.wa').waitFor();await button('查看 Diff').click();
  assert.match((await page.locator('.diff-view .added').allTextContents()).join(''),/42/);
  await save();await page.screenshot({path:path.join(evidence,'desktop-self-test.png'),fullPage:true});
  console.log('PASS project/problem creation, unsaved-change cancel, manual saving, AC/WA and Diff');

  await settings();await input('学号').fill('12345678');await input('姓名').fill('测试同学');
  await select('保存方式').selectOption('auto');
  const missing=path.join(temporary,'missing'),dataField=page.locator('.path-field').filter({has:input('数据保存位置')});
  await input('数据保存位置').fill(missing);await until(()=>dataField.textContent().then(v=>v.includes('路径不存在')),'invalid directory error');
  assert.equal(await button('保存设置').isDisabled(),true);
  await input('数据保存位置').fill(data);
  await select('编译器使用方式').selectOption('custom');await select('工具链类型').selectOption('zig');
  await input('C 驱动路径').fill(missing);
  const cField=page.locator('.path-field').filter({has:input('C 驱动路径')});
  await until(()=>cField.textContent().then(v=>v.includes('路径不存在')),'invalid compiler error');assert.equal(await button('保存设置').isDisabled(),true);
  await page.screenshot({path:path.join(evidence,'settings-path-validation.png'),fullPage:true});
  const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,resources:process.resourcesPath,platform:process.platform,arch:process.arch}));
  const target=(runtime.platform==='win32'?'win':runtime.platform==='darwin'?'mac':'linux')+'-'+runtime.arch;
  const zig=path.join(runtime.packaged?path.join(runtime.resources,'toolchain'):path.resolve(cwd,'../.work/toolchains',target),runtime.platform==='win32'?'zig.exe':'zig');
  await files([zig]);await button('选择C 驱动路径').click();await until(()=>input('C 驱动路径').inputValue().then(v=>v===zig),'compiler picker');
  await input('C++ 驱动路径').fill(missing);
  await until(()=>page.locator('.path-field').filter({has:input('C++ 驱动路径')}).textContent().then(v=>v.includes('路径不存在')),'invalid C++ path');
  await button('选择C++ 驱动路径').click();await apply();
  const autoSource='// auto saved\n'+printing(42);await edit(autoSource);
  await until(()=>fs.readFile(managed,'utf8').then(v=>v===autoSource),'automatic save');await saved();
  await exportFile('12345678_Lab 2-1.c');
  console.log('PASS directory/compiler inline validation, native path pickers, custom Zig and automatic saving');

  const external=path.join(temporary,'用户源码.c');await fs.writeFile(external,printing(9));await files([external]);await button('打开源码').click();
  await until(()=>page.locator('.pane-heading').first().textContent().then(v=>v.includes('用户源码.c')),'external source');
  await edit(printing(10));await until(()=>fs.readFile(external,'utf8').then(v=>v===printing(10)),'automatic original-file save');await saved();
  assert.equal(await fs.readFile(managed,'utf8'),autoSource);
  await settings();await select('保存方式').selectOption('manual');await apply();
  await edit(printing(11));await page.waitForTimeout(500);assert.equal(await fs.readFile(external,'utf8'),printing(10));
  await run();await page.locator('.verdict.wa').waitFor();assert.equal(await fs.readFile(external,'utf8'),printing(10));
  await save();assert.equal(await fs.readFile(external,'utf8'),printing(11));
  console.log('PASS opened source saves to its original path in both saving modes');

  const relocated=path.join(temporary,'迁移资料');await fs.mkdir(relocated);
  await settings();await files([relocated]);await button('选择数据保存位置').click();
  await until(()=>input('数据保存位置').inputValue().then(v=>v===relocated),'directory picker');await apply();
  assert.equal((await page.evaluate(()=>window.labpad.bootstrap())).dataRoot,await fs.realpath(relocated));
  assert.match(await page.locator('.cm-content').textContent(),/11/);
  assert.equal(JSON.parse(await fs.readFile(path.join(relocated,'config.json'),'utf8')).sourceFile,external);
  assert.equal(await fs.readFile(managed,'utf8'),autoSource);
  await edit(printing(12));await until(()=>page.locator('.save-status').textContent().then(t=>t==='未保存'),'unsaved edit is applied');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(250);assert.equal(page.isClosed(),false);assert.equal(await fs.readFile(external,'utf8'),printing(11));
  await save();times.push(...await page.evaluate(()=>window.__compiles.filter(c=>c.status==='success').map(c=>c.elapsedMs)));
  await app.close();app=await launch();await prepare();
  const restored=await page.evaluate(()=>window.labpad.bootstrap());
  assert.equal(restored.dataRoot,await fs.realpath(relocated));assert.equal(restored.config.studentId,'12345678');assert.equal(restored.config.saveMode,'manual');assert.equal(restored.config.sourceFile,external);
  assert.match(await page.locator('.cm-content').textContent(),/12/);assert.equal(await select('题号').inputValue(),'Lab 2-1');
  await run();await page.locator('.verdict.wa').waitFor({timeout:150000});
  const afterRestart=await page.evaluate(()=>window.__compiles.find(c=>c.status==='success').elapsedMs);
  console.log('PASS data relocation, external-file binding, close cancellation and restart persistence');
  console.log('COMPILATION_TIMES',JSON.stringify({firstSuccessfulMs:times[0],afterRestartMs:afterRestart}));

  const ioIn=path.join(temporary,'例子.IN'),ioOut=path.join(temporary,'例子.OUT');
  await fs.writeFile(ioIn,'9\n');await fs.writeFile(ioOut,'12\n');await files([ioIn,ioOut]);await button('导入标准 I/O').click();
  await until(()=>page.getByRole('status').textContent().then(t=>t.includes('已导入')),'I/O import');
  assert.equal(await fs.readFile(external,'utf8'),printing(12));
  const problemFile=path.join(relocated,'projects','Lab 2','Lab 2-1.json'),problem=JSON.parse(await fs.readFile(problemFile,'utf8'));
  assert.equal(problem.testCases[0].input,'9\n');problem.comparison={type:'floatTokens',absoluteTolerance:.001};await fs.writeFile(problemFile,JSON.stringify(problem,null,2));
  await button('重新加载').click();
  await until(async()=>JSON.stringify((await page.evaluate(()=>window.labpad.bootstrap())).draft.problem.comparison)===JSON.stringify(problem.comparison),'JSON rule reload');
  assert.match(await page.locator('.cm-content').textContent(),/12/);assert.deepEqual(errors,[]);
  console.log('PASS imported I/O copies and JSON reload preserve the original source');
  await fs.rename(external,external+'.bak');await fs.mkdir(external);
  await edit(printing(13));await button('保存').click();
  await until(()=>page.locator('.save-status').textContent().then(t=>t==='保存失败'),'failed save is reported');
  await app.evaluate(()=>{globalThis.__nextAnswer=1;});await app.close();
  console.log('PASS a failed save remains unsaved and can be explicitly discarded on close');
  console.log('ALL DESKTOP CHECKS PASSED');
 }catch(error){
  if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});}
  throw error;
 }finally{
  await app.evaluate(()=>{globalThis.__nextAnswer=1;}).catch(()=>{});
  await app.close().catch(()=>{});
  await fs.rm(temporary,{recursive:true,force:true});
 }
}
module.exports={runScenario};
if(require.main===module){
 const {_electron}=require('playwright');
 runScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});
}
