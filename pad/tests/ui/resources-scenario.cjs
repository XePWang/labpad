const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const until=async(fn,label,timeout=150000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timeout: '+label);};
async function runResourcesScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-resources-')),data=path.join(temporary,'labpad'),cache=path.join(temporary,'compiler-cache'),errors=[];
 const app=await electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data,LABPAD_CACHE_DIR:cache}});
 let page;const samples=[];
 try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  const button=name=>page.getByRole('button',{name,exact:true}),editor=()=>page.locator('.cm-content'),tabs=()=>page.getByRole('tab'),state=()=>page.evaluate(()=>window.labpad.bootstrap());
 async function importSource(){await button('导入').click();await page.getByRole('menuitem',{name:'导入源码',exact:true}).click();}
  const runtime=await app.evaluate(({app})=>({pid:process.pid,profile:app.getPath('userData')}));
  await app.evaluate(({dialog})=>{globalThis.__answer=2;dialog.showMessageBox=async()=>({response:globalThis.__answer,checkboxChecked:false});});
  await page.getByRole('button',{name:/设置/}).click();await page.getByRole('checkbox',{name:'保存时自动格式化'}).uncheck();await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  const source='#include <stdio.h>\nint main(void){puts("ready-中文");fflush(stdout);char line[80];fgets(line,sizeof line,stdin);return 0;}\n';
  await editor().fill(source);await page.keyboard.press('Control+s');await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'save');
  async function menu(name,index=0){await tabs().nth(index).click({button:'right'});await page.getByRole('menuitem',{name,exact:true}).click();}
  // Context menu operations and key sequences.
  await menu('另存为新版本');await until(()=>tabs().count().then(n=>n===2),'version 2');await menu('另存为新版本');await until(()=>tabs().count().then(n=>n===3),'version 3');
  await menu('关闭右侧标签页',1);await until(()=>tabs().count().then(n=>n===2),'close right');await editor().fill(source+'// unsaved');
  await page.keyboard.press('Control+k');await page.keyboard.press('u');await until(()=>tabs().count().then(n=>n===1),'close saved chord');assert.equal(await page.locator('.tab-dirty').count(),1);
  await page.keyboard.press('Control+k');await page.keyboard.press('w');await page.waitForTimeout(150);assert.equal(await tabs().count(),1);assert.equal((await state()).draft.source,source+'// unsaved'); // Cancel leaves all views.
  await app.evaluate(()=>globalThis.__answer=0);await page.keyboard.press('Control+F4');await until(()=>tabs().count().then(n=>n===0),'save and close');assert.equal(await editor().count(),0);
  const owned=(await state()).draft.sourceFile;await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},owned);await importSource();await until(()=>tabs().count().then(n=>n===1),'reopen closed file');await editor().fill(source);await page.keyboard.press('Control+s');
  console.log('PASS close right, close saved/all sequences, cancellation, Ctrl+F4 save and reopen');
  await until(async()=>(await fs.readFile(owned,'utf8'))===source,'original save completed');const beforeDiscard=await fs.readFile(owned,'utf8');await editor().fill(source+'// discarded source');await app.evaluate(()=>globalThis.__answer=1);await menu('全部关闭');await until(()=>tabs().count().then(n=>n===0),'discard and close all');
  await page.getByRole('button',{name:/新增测试点/}).click();await button('保存').click();await page.getByRole('menuitem',{name:'保存当前',exact:true}).click();await until(async()=>JSON.parse(await fs.readFile(path.join(data,'空项目.json'),'utf8')).testCases.length===1,'rules saved without a source view');assert.equal(await fs.readFile(owned,'utf8'),beforeDiscard);
  await page.getByRole('button',{name:'删除测试点',exact:true}).click();await button('保存').click();await page.getByRole('menuitem',{name:'保存全部',exact:true}).click();await until(async()=>JSON.parse(await fs.readFile(path.join(data,'空项目.json'),'utf8')).testCases.length===0,'rules cleared');await importSource();await until(()=>tabs().count().then(n=>n===1),'owned version reopens');
  console.log('PASS saving rules with all source tabs closed never saves discarded source edits');

  // Open/close child windows repeatedly; record a user-defined key.
  for(let cycle=0;cycle<4;cycle++){
   await page.getByRole('button',{name:/设置/}).click();await button('设置快捷键…').click();await until(()=>app.windows().length===2,'shortcut window');const popup=app.windows().find(w=>w!==page);await popup.getByRole('heading',{name:'快捷键',exact:true}).waitFor();
   if(!cycle){await popup.getByRole('button',{name:'录制',exact:true}).first().click();await popup.keyboard.press('F7');await until(()=>popup.getByRole('textbox',{name:'编译并运行 快捷键',exact:true}).inputValue().then(t=>t==='F7'),'recorded shortcut');await popup.getByRole('button',{name:'保存快捷键',exact:true}).click();await until(()=>popup.getByRole('status').textContent().then(t=>t.includes('已保存')),'record saved');}
   await popup.close();await button('取消').click();await until(()=>app.windows().length===1,'child disposed');
  }
  console.log('PASS shortcut recording and repeated settings-window lifecycle');
  async function heap(){
   const info=await app.evaluate(async({BrowserWindow,app})=>{const wc=BrowserWindow.getAllWindows()[0].webContents;wc.debugger.attach('1.3');try{await wc.debugger.sendCommand('HeapProfiler.collectGarbage');return app.getAppMetrics().find(p=>p.pid===wc.getOSProcessId()).memory;}finally{wc.debugger.detach();}});
   return info.workingSetSize;
  }
  samples.push(await heap());
  // Repeated PTY sessions and closing histories should leave no running programs or session output.
  for(let cycle=0;cycle<8;cycle++){
   await editor().fill(source+'// cycle '+cycle);await page.keyboard.press('F7');await until(()=>page.locator('.phase').textContent().then(t=>t.includes('调试运行中')),'debug started');
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+c');await until(()=>page.locator('.phase').textContent().then(t=>t==='已停止'),'debug stopped');
   await menu('另存为新版本');await until(()=>tabs().count().then(n=>n===2),'new version');await app.evaluate(()=>globalThis.__answer=1);await menu('关闭',1);await until(()=>tabs().count().then(n=>n===1),'version closes');
   const directories=(await fs.readdir(os.tmpdir())).filter(n=>n.startsWith('labpad-runtime-'+runtime.pid+'-'));assert.equal(directories.length,1);
   assert.deepEqual((await fs.readdir(path.join(os.tmpdir(),directories[0]))).filter(n=>n.startsWith('run-')),[]);
   if(cycle===3||cycle===7)samples.push(await heap());
  }
  assert.ok(samples.at(-1)<samples[0]+80000,'renderer private memory grew by more than 80 MB: '+samples);assert.equal(app.windows().length,1);assert.deepEqual(errors,[]);
  console.log('PASS eight repeated compile/PTY/stop/version-close cycles free run directories; memory KB '+JSON.stringify(samples));
  // Scale extremes and moving managed version data.
  await app.evaluate(()=>globalThis.__answer=0);await page.keyboard.press('Control+s');
  const relocated=path.join(temporary,'relocated');await fs.mkdir(relocated);
  await page.getByRole('button',{name:/设置/}).click();await page.getByRole('textbox',{name:'数据保存位置',exact:true}).fill(relocated);await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal((await state()).dataRoot,await fs.realpath(relocated));assert.ok((await state()).sourcePath.startsWith(relocated));assert.ok((await fs.readdir(relocated)).some(n=>n.startsWith('空项目.v')));assert.ok((await fs.readdir(data)).some(n=>n.startsWith('空项目.v')));
  for(const factor of ['2','0.75','1']){
   await page.getByRole('button',{name:/设置/}).click();await page.getByRole('combobox',{name:'界面缩放',exact:true}).selectOption(factor);await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),Number(factor));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await fs.writeFile(path.join(evidence,'resource-checks.json'),JSON.stringify({platform:process.platform,privateKB:samples,cycles:8},null,2));console.log('PASS source versions relocate with originals preserved and 75% / 200% scale fits without page overflow');
 }catch(e){if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'resources-failure.png'),fullPage:true}).catch(()=>{});}throw e;}
 finally{await app.evaluate(()=>globalThis.__answer=1).catch(()=>{});await app.close().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={runResourcesScenario};
if(require.main===module){const {_electron}=require('playwright');runResourcesScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});}
