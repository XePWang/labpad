const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
async function until(fn,label,timeout=30000){
 const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timeout: '+label);
}
async function runLayoutScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-layout-'));
 assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));
 const data=path.join(temporary,'labpad'),errors=[],checks=[];
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page;
 const button=name=>page.getByRole('button',{name,exact:true});
 const editor=()=>page.locator('.cm-content'),status=()=>page.getByRole('status');
 const vertical=()=>page.locator('.workspace > .splitpanes__splitter'),horizontal=()=>page.locator('.work-layout > .splitpanes__splitter');
 const state=()=>page.evaluate(()=>window.labpad.bootstrap());
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog,ipcMain})=>{globalThis.__sizes=[];dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});ipcMain.on('debug:resize',(_event,cols,rows)=>globalThis.__sizes.push({cols,rows}));});
  await page.evaluate(()=>{window.__debug=[];window.labpad.onDebugData(d=>window.__debug.push(d));});
 }
 async function drag(locator,dx,dy){
  const box=await locator.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:10});await page.mouse.up();await page.waitForTimeout(250);
 }
 async function setSource(source){await editor().focus();await page.keyboard.press('Control+a');await page.keyboard.insertText(source);await until(async()=>(await state()).draft.source===source,'source inserted through editor input');}
 function pass(label){checks.push(label);console.log('PASS '+label);}
 try{
  await prepare();assert.equal(await page.locator('.runbar').count(),0);assert.equal(await page.getByText('程序设计实验 · 本地自测',{exact:true}).count(),0);assert.equal(await page.getByText('原始编译与运行信息',{exact:true}).count(),0);
  const problem=await page.getByRole('combobox',{name:'题号',exact:true}).boundingBox(),run=await page.getByRole('button',{name:/编译并运行/}).boundingBox();
  assert.ok(run.x>=problem.x+problem.width);assert.ok(Math.abs(run.y-problem.y)<12);
  assert.equal(await page.locator('footer').locator(':scope > *').count(),2);assert.equal(await page.locator('footer .compiler-label').count(),0);assert.equal(await page.locator('footer .status-folder').count(),0);assert.equal(await page.locator('.toolbar .compiler-label').count(),0);
  assert.equal(await vertical().getAttribute('role'),'separator');assert.equal(await horizontal().getAttribute('role'),'separator');
  pass('one toolbar row keeps run/stop/status after problem selection; footer has two contextual items; redundant subtitles removed');
  const multicursor='int value = value;\n';await setSource(multicursor);await editor().focus();await page.keyboard.press('Control+Home');for(let n=0;n<5;n++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+d');await page.keyboard.press('Control+d');await until(()=>status().textContent().then(t=>t.includes('已选 10 个字符 · 1 行')),'multi-selection counts distinct lines');await page.waitForTimeout(550);await page.keyboard.insertText('item');await until(async()=>(await state()).draft.source==='int item = item;\n','multi-cursor edits');await page.keyboard.press('Control+z');await until(async()=>(await state()).draft.source===multicursor,'multi-cursor edit atomic undo');pass('Ctrl+D multi-selection reports distinct lines and edits atomically');
  const source='int main(void) {\n    int value = 1;\n    return value;\n}\n';await setSource(source);await editor().focus();await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowDown');
  await until(()=>page.locator('.cursor-position').textContent().then(t=>t.includes('行 2 · 列 1')),'cursor position follows arrows');
  await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+ArrowDown');
  await until(()=>status().textContent().then(t=>t.includes('已选 '+(source.split('\n')[0].length+1)+' 个字符')),'selection status and shortcut hint');
  await page.keyboard.press('Control+Home');assert.equal((await state()).draft.source,source);
  const textBefore=(await state()).draft.source,editorBefore=(await page.locator('.editor-pane').boundingBox()).width,bottomBefore=(await page.locator('.bottom-panel').boundingBox()).height;
  await drag(vertical(),150,0);assert.ok((await page.locator('.editor-pane').boundingBox()).width>editorBefore+100);
  await drag(horizontal(),0,-90);assert.ok((await page.locator('.bottom-panel').boundingBox()).height>bottomBefore+60);
  assert.equal((await state()).draft.source,textBefore);assert.equal(await page.locator('.save-status').textContent(),'未保存');
  pass('cursor/selection update live; mouse dragging changes both dimensions without editing or saving source');
  await vertical().focus();const percentBefore=(await state()).config.layout.editorPercent;await page.keyboard.press('ArrowLeft');
  await until(async()=>(await state()).config.layout.editorPercent<percentBefore,'vertical arrow-key resize');
  for(let n=0;n<20;n++)await page.keyboard.press('ArrowLeft');await until(async()=>(await state()).config.layout.editorPercent===20,'vertical minimum');
  for(let n=0;n<20;n++)await page.keyboard.press('ArrowRight');await until(async()=>(await state()).config.layout.editorPercent===80,'vertical maximum');
  await horizontal().focus();const outputBefore=(await state()).config.layout.outputPercent;await page.keyboard.press('ArrowUp');
  await until(async()=>(await state()).config.layout.outputPercent>outputBefore,'horizontal arrow-key resize');
  const layout=(await state()).config.layout;
  await until(async()=>JSON.stringify(JSON.parse(await fs.readFile(path.join(data,'config.json'),'utf8')).layout)===JSON.stringify(layout),'layout persisted to config');
  pass('native splitter keyboard arrows honor limits and persist the layout');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,780));await page.waitForTimeout(400);
  const fits=await page.evaluate(()=>({width:innerWidth,height:innerHeight,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight}));
  assert.ok(fits.docWidth<=fits.width+1);assert.ok(fits.docHeight<=fits.height+1);assert.ok((await page.locator('.bottom-panel').boundingBox()).height>50);
  assert.equal((await state()).draft.source,textBefore);
  const casePane=await page.locator('.cases-pane').boundingBox();
  for(const label of ['题目文件','重新加载','＋ 新增']){const box=await button(label).boundingBox();assert.ok(box.x>=casePane.x&&box.x+box.width<=casePane.x+casePane.width+1,'narrow pane button remains visible: '+label);}
  await page.screenshot({path:path.join(evidence,'layout-compact.png'),fullPage:true});
  await editor().focus();await page.keyboard.press('Control+Home');const oldHint=await status().textContent();await page.waitForTimeout(9300);assert.notEqual(await status().textContent(),oldHint);
  pass('smaller windows fit without page overflow; idle hints rotate and reduced rows preserve work area');
  await setSource('#include <stdio.h>\nint main(void){int n;puts("ready");fflush(stdout);while(scanf("%d",&n)==1){printf("value=%d\\n",n);fflush(stdout);}return 0;}\n');
  await page.getByRole('button',{name:/编译并运行/}).click();await until(()=>page.locator('.phase').textContent().then(t=>t.includes('调试运行中')),'debug running',150000);
  await until(()=>page.evaluate(()=>window.__debug.join('').includes('ready')),'live debug terminal');
  const sizeBefore=await app.evaluate(()=>globalThis.__sizes.at(-1));await drag(horizontal(),0,80);
  await until(async()=>{const size=await app.evaluate(()=>globalThis.__sizes.at(-1));return size&&sizeBefore&&size.rows!==sizeBefore.rows;},'terminal refits after splitter drag');
  await page.getByRole('textbox',{name:'调试输入',exact:true}).focus();await page.keyboard.type('5');await page.keyboard.press('Enter');await until(()=>page.evaluate(()=>window.__debug.join('').includes('value=5')),'terminal remains interactive after resizing');
  const scrolling=await page.evaluate(()=>({page:document.scrollingElement.scrollTop,shell:document.querySelector('.app-shell').scrollTop}));assert.deepEqual(scrolling,{page:0,shell:0});
  await page.screenshot({path:path.join(evidence,'layout-debug-resized.png'),fullPage:true});await page.getByRole('button',{name:/停止程序/}).click();await until(()=>page.locator('.phase').textContent().then(t=>t.includes('已停止')),'stop debug');
  pass('running PTY receives new terminal dimensions and accepts input after resizing');
  const persisted=(await state()).config.layout;await app.close();app=await launch();await prepare();
  assert.deepEqual((await state()).config.layout,persisted);
  assert.deepEqual(errors,[]);pass('split proportions restore after restart');await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({platform:process.platform,checks},null,2));console.log('ALL LAYOUT CHECKS PASSED ('+checks.length+' groups)');
 }catch(error){
  if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});}throw error;
 }finally{await app.close().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={runLayoutScenario};
if(require.main===module){const {_electron}=require('playwright');runLayoutScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(error=>{console.error(error);process.exitCode=1;});}
