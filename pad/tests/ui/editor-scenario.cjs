const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
async function until(fn,label,timeout=30000){
 const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+label);
}
async function clipboardGuard(marker){
 if(process.platform!=='win32')return async()=>{};
 const child=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'clipboard-guard.ps1'),'-Marker',marker],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='';child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{error+=d;});
 await until(()=>output.includes('READY')||(child.exitCode!==null?Promise.reject(new Error('clipboard guard: '+error)):false),'clipboard backup');
 return async()=>{child.stdin.end('\n');await until(()=>child.exitCode!==null,'clipboard restore');assert.equal(child.exitCode,0,error);};
}
async function runEditorScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-editor-中文-'));
 const data=path.join(temporary,'labpad'),marker='LabPad-test-'+randomUUID(),errors=[],checks=[];
 const restoreClipboard=await clipboardGuard(marker);
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch(),page,sequence=0,currentFile='';
 const key=keys=>page.keyboard.press(keys);
 const editor=()=>page.locator('.cm-content');
 const button=name=>page.getByRole('button',{name,exact:true});
 const select=name=>page.getByRole('combobox',{name,exact:true});
 const state=()=>page.evaluate(()=>window.labpad.bootstrap());
 const text=async()=>(await state()).draft.source;
 const equal=async(expected,label)=>{await until(async()=>(await text())===expected,label);assert.equal(await text(),expected);};
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{
   globalThis.__file='';globalThis.__answer=1;
   dialog.showMessageBox=async()=>({response:globalThis.__answer,checkboxChecked:false});
   dialog.showOpenDialog=async()=>({canceled:!globalThis.__file,filePaths:[globalThis.__file]});
  });
 }
 async function open(source){
  currentFile=path.join(temporary,'source-'+(++sequence)+'.c');await fs.writeFile(currentFile,source);
  await app.evaluate((_,file)=>{globalThis.__file=file;},currentFile);
  await button('打开源码').click();await equal(source,'open fixture');await editor().focus();
  await key('Control+Home');
 }
 async function settings(values){
  await page.getByRole('button',{name:/设置/}).click();await page.getByRole('dialog').waitFor();
  for(const [label,value] of Object.entries(values)){
   if(typeof value==='boolean')await page.getByRole('checkbox',{name:label,exact:true}).setChecked(value);
   else await select(label).selectOption(String(value));
  }
  await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});await editor().focus();
 }
 async function at(index){await editor().focus();await key('Control+Home');for(let n=0;n<index;n++)await key('ArrowRight');}
 async function saved(){await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'save complete');}
 function pass(label){checks.push(label);console.log('PASS '+label);}
 try{
  await prepare();const defaults=(await state()).config;
  assert.equal(defaults.indentSize,4);assert.equal(defaults.theme,'dark');assert.equal(defaults.formatOnSave,true);assert.equal(defaults.saveMode,'manual');
  pass('editor defaults: four spaces, dark theme, manual saving and format-on-save enabled');
  for(const width of [1,2,4]){
   await settings({'Tab / 缩进空格数':width});const unit=' '.repeat(width);
   await open('first();\nsecond();\nthird();');
   await key('Tab');await equal(unit+'first();\nsecond();\nthird();','Tab indents');
   await key('Shift+Tab');await equal('first();\nsecond();\nthird();','Shift Tab dedents');
   await open('first();\nsecond();\nthird();');
   await key('Shift+ArrowDown');await key('Shift+ArrowDown');await key('Tab');
   await equal(unit+'first();\n'+unit+'second();\nthird();','selected lines indent, final boundary excluded');
   await key('Control+z');await equal('first();\nsecond();\nthird();','block indent atomic undo');
   await key('Control+y');await equal(unit+'first();\n'+unit+'second();\nthird();','block indent redo');
   await key('Shift+Tab');await equal('first();\nsecond();\nthird();','selected lines dedent');
   await key('Control+z');await equal(unit+'first();\n'+unit+'second();\nthird();','block dedent atomic undo');
   await open('int main(void) {}');await key('Control+End');await key('ArrowLeft');await key('Enter');
   await equal('int main(void) {\n'+unit+'\n}','brace split and closing alignment');
   await page.keyboard.insertText('if (1) {}');await key('ArrowLeft');await key('Enter');
   await equal('int main(void) {\n'+unit+'if (1) {\n'+unit+unit+'\n'+unit+'}\n}','nested AST indentation');
   await page.keyboard.insertText('value++;');await key('Enter');await page.keyboard.insertText('next();');
   await equal('int main(void) {\n'+unit+'if (1) {\n'+unit+unit+'value++;\n'+unit+unit+'next();\n'+unit+'}\n}','Enter preserves contextual level');
   await open('int main(void) {\n'+unit+'call(first,\n}');await key('ArrowDown');await key('End');await key('Enter');
   const hanging=(await text()).split('\n')[2];assert.ok(hanging.length>width,'hanging indent uses argument alignment');
   assert.equal(hanging.trim(),'');assert.equal(hanging.length,width+'call('.length);
   await open('int main(void) {\n'+unit+'puts("{");\n}');await key('ArrowDown');await key('End');await key('Enter');
   assert.equal((await text()).split('\n')[2],unit,'brace in string does not open a new block');
   pass('indent '+width+': Tab/Shift+Tab, selection boundary, atomic undo/redo, nested braces, Enter and hanging arguments');
  }

  await open('alpha\nbeta\ngamma');await key('Control+End');await key('Home');await key('Shift+End');
  assert.equal(await page.evaluate(()=>getSelection().toString()),'gamma');
  await key('Control+Home');await key('Control+Shift+End');assert.equal(await page.evaluate(()=>getSelection().toString()),'alpha\nbeta\ngamma');
  await key('ArrowLeft');await key('Control+/');await equal('// alpha\nbeta\ngamma','line comment toggle');
  await key('Control+/');await equal('alpha\nbeta\ngamma','line uncomment toggle');
  await key('Control+f');const search=page.locator('.cm-search input[name="search"]');await search.waitFor();await search.fill('beta');
  await key('Enter');await until(()=>page.locator('.cm-searchMatch, .cm-searchMatch-selected').count().then(n=>n>0),'search highlights');await key('Escape');assert.equal(await page.locator('.cm-search').count(),0);
  await key('Control+h');await page.locator('.cm-search input[name="replace"]').waitFor();
  await page.locator('.cm-search input[name="search"]').fill('beta');await page.locator('.cm-search input[name="replace"]').fill('delta');
  await page.locator('.cm-search button[name="replaceAll"]').click();await key('Escape');await equal('alpha\ndelta\ngamma','native replace all');
  await editor().focus();await key('Control+z');await equal('alpha\nbeta\ngamma','replace all atomic undo');
  await key('Control+Shift+Z');await equal('alpha\ndelta\ngamma','second redo shortcut');
  await open('one();\ntwo();');await key('Alt+ArrowDown');await equal('two();\none();','move line down');
  await key('Control+z');await equal('one();\ntwo();','line move atomic undo');
  await key('Shift+Alt+ArrowDown');await equal('one();\none();\ntwo();','duplicate line');
  await key('Control+z');await equal('one();\ntwo();','duplicate line atomic undo');
  await key('Escape');await key('Tab');
  assert.equal(await editor().evaluate(el=>el===document.activeElement),false,'Escape then Tab moves focus out of editor');
  pass('navigation, select all, line comments, search/replace, both redo keys, line movement/duplication and keyboard focus escape');

  await open(marker);await key('Control+a');await key('Control+c');
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),marker);
  await key('End');await key('Control+v');await equal(marker+marker,'clipboard paste');
  await key('Control+z');await equal(marker,'paste atomic undo');
  await key('Control+a');await key('Control+x');await equal('','clipboard cut');
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),marker);
  await key('Control+z');await equal(marker,'cut atomic undo');await key('End');await key('Backspace');
  await equal(marker.slice(0,-1),'Backspace');await key('Home');await key('Delete');await equal(marker.slice(1,-1),'Delete');
  const multiline=marker+'\n    int value;\n';await open(multiline);await key('Control+a');await key('Control+c');await key('Control+End');await key('Control+v');await equal(multiline+multiline,'multiline clipboard paste');await key('Control+z');await equal(multiline,'multiline paste atomic undo');
  pass('Ctrl+A/C/X/V, cut/paste one-step undo, Backspace and Delete with guarded clipboard');

  const raw='int main(){int result=1;return result;}';
  await open(raw);await at(raw.lastIndexOf('result')+3);
  const expected=await page.evaluate(source=>window.labpad.formatCode(source,'c',4),raw);
  await button('格式化代码').click();await equal(expected,'format button uses WASM');
  const caret=await editor().evaluate(el=>{
   const selection=getSelection(),node=selection.anchorNode,line=(node.nodeType===1?node:node.parentElement).closest('.cm-line');
   const range=document.createRange();range.selectNodeContents(line);range.setEnd(node,selection.anchorOffset);
   return {line:line.textContent,before:range.toString()};
  });
  assert.equal(caret.before.trim(),'return res','format preserves cursor within unchanged token');
  await key('Control+z');await equal(raw,'one undo restores complete unformatted document');
  await key('Control+Shift+Z');await equal(expected,'one redo restores complete format');
  await key('Control+z');await key('Shift+Alt+F');await equal(expected,'format shortcut');
  await key('Control+z');await equal(raw,'shortcut format is one undo step');
  const wide='int main(void){return function_with_long_name(first_long_parameter_name,second_long_parameter_name,third_long_parameter_name,fourth_long_parameter_name);}';
  await open(wide);await key('Shift+Alt+F');await until(async()=>(await text())!==wide,'long line format');assert.ok((await text()).split('\n').every(line=>line.length<=80));
  const fragmented='int\nsum(\nint a,\nint b\n){return a+b;}';await open(fragmented);await button('格式化代码').click();await until(async()=>(await text()).includes('int sum(int a, int b) {'),'join fragmented lines');
  pass('real WASM format button/shortcut, wrapping/joining, cursor mapping and single-step undo/redo');

  await open('int main(void) {\n    return 0;\n}\n');
  await until(()=>page.locator('.cm-highlightSpace').count().then(n=>n>0),'visible whitespace marks');
  let whitespace=await page.locator('.cm-highlightSpace').first().evaluate(el=>getComputedStyle(el).background);
  assert.match(whitespace,/0.35/);assert.match(whitespace,/repeat-x/);assert.match(whitespace,/\/ [\d.]+px 100%/);assert.ok(!(await text()).includes('·'));
  await key('Control+End');await page.keyboard.insertText('// theme stays in history');
  const beforeTheme=await text();await settings({'主题':'light'});
  assert.equal(await page.locator('.app-shell').getAttribute('data-theme'),'light');
  assert.equal(await editor().evaluate(el=>getComputedStyle(el.closest('.cm-editor')).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource),'light');
  await button('调试').click();assert.equal(await page.locator('.xterm-scrollable-element').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');await button('输出').click();
  assert.equal(await text(),beforeTheme);
  await key('Control+z');await equal('int main(void) {\n    return 0;\n}\n','theme does not reset history');
  await page.screenshot({path:path.join(evidence,'editor-light.png'),fullPage:true});
  await page.getByRole('button',{name:/设置/}).click();await page.screenshot({path:path.join(evidence,'settings-light.png'),fullPage:true});await button('取消').click();
  await settings({'主题':'dark'});assert.equal(await editor().evaluate(el=>getComputedStyle(el.closest('.cm-editor')).backgroundColor),'rgb(30, 30, 30)');
  await button('调试').click();assert.equal(await page.locator('.xterm-scrollable-element').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(30, 30, 30)');await button('输出').click();
  whitespace=await page.locator('.cm-highlightSpace').first().evaluate(el=>getComputedStyle(el).background);assert.match(whitespace,/0.35/);
  await page.screenshot({path:path.join(evidence,'editor-dark.png'),fullPage:true});
  pass('space dots are rendering-only at 0.35 alpha; light/dark shell/editor keep text, selection history and native theme');

  const savedExpected=await page.evaluate(source=>window.labpad.formatCode(source,'c',4),raw+'\n');
  await open(raw);await key('Control+End');await key('Enter');await key('Control+s');await saved();
  assert.equal(await text(),savedExpected);assert.equal(await fs.readFile(currentFile,'utf8'),savedExpected);
  assert.ok(!expected.includes('\t'));assert.ok(!expected.includes('·'));
  await key('Control+z');await equal(raw+'\n','save-time formatting is one undo step');assert.equal(await page.locator('.save-status').textContent(),'未保存');
  await key('Control+y');await equal(savedExpected,'redo saved format');await key('Control+s');await saved();
  await settings({'保存时自动格式化':false});await open(raw);await key('End');await page.keyboard.insertText(' ');await key('Control+s');await saved();
  assert.equal(await fs.readFile(currentFile,'utf8'),raw+' ');assert.equal(await text(),raw+' ');
  await settings({'保存时自动格式化':true,'保存方式':'auto'});
  await page.keyboard.insertText(' ');await saved();assert.equal(await fs.readFile(currentFile,'utf8'),expected);assert.equal(await text(),expected);
  const stamp=(await fs.stat(currentFile)).mtimeMs;await page.waitForTimeout(800);assert.equal((await fs.stat(currentFile)).mtimeMs,stamp,'formatted auto-save does not loop');
  await settings({'保存方式':'manual'});
  pass('Ctrl+S formats and atomically saves original file; undo marks dirty; disabled formatting preserves bytes; auto-save formats once without loops');

  const background='int main(void){\n'+Array.from({length:5000},(_,i)=>'int item_'+i+'=1+2;').join('\n')+'\nreturn 0;}';
  async function queueFormatter(){
   await page.evaluate(source=>{window.__formatQueue=Promise.all(Array.from({length:12},()=>window.labpad.formatCode(source,'c',4)));},background);
  }
  await open(raw);await queueFormatter();await button('格式化代码').click();await editor().focus();await key('Control+Home');await page.keyboard.insertText('// newer edit');await key('Enter');
  await until(()=>button('格式化代码').isEnabled(),'stale format completes',60000);
  await equal('// newer edit\n'+raw,'format never overwrites newer typing');
  assert.match(await page.getByRole('status').textContent(),/已改变/);await page.evaluate(()=>window.__formatQueue);
  await queueFormatter();await key('Control+s');await editor().focus();await key('Control+Home');await page.keyboard.insertText('// during save');await key('Enter');
  await until(async()=>(await fs.readFile(currentFile,'utf8')).startsWith('// newer edit'),'save snapshot reaches disk',60000);
  await equal('// during save\n// newer edit\n'+raw,'in-flight save never overwrites newer typing');
  assert.equal(await page.locator('.save-status').textContent(),'未保存');await page.evaluate(()=>window.__formatQueue);
  await key('Control+s');await saved();assert.match(await fs.readFile(currentFile,'utf8'),/^\/\/ during save\n\/\/ newer edit\n/);
  pass('format/save concurrency preserves newer edits and leaves unsaved revision marked dirty');

  await open(background);const largeExpected=await page.evaluate(source=>window.labpad.formatCode(source,'c',4),background),started=Date.now();await button('格式化代码').click();await equal(largeExpected,'large format stays responsive');assert.ok(Date.now()-started<10000);await key('Control+z');await equal(background,'large format remains one undo step');pass('large formatting uses bounded native diff and retains atomic undo');

  await open('int file_a;\n');await page.keyboard.insertText('// A\n');await open('int file_b;\n');await key('Control+z');await equal('int file_b;\n','document switch isolates undo history');
  await settings({'Tab / 缩进空格数':2,'主题':'light'});await key('Control+End');await page.keyboard.insertText('// persisted');
  await key('Control+s');await saved();const persisted=await text(),file=currentFile;
  await app.close();app=await launch();await prepare();const restored=await state();
  assert.equal(restored.config.indentSize,2);assert.equal(restored.config.theme,'light');assert.equal(restored.config.formatOnSave,true);assert.equal(restored.config.sourceFile,file);assert.equal(restored.draft.source,persisted);
  await editor().focus();await key('Control+Home');await key('Tab');assert.ok((await text()).startsWith('  int file_b;'));
  await app.evaluate(()=>{globalThis.__answer=2;});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.waitForTimeout(150);assert.equal(page.isClosed(),false);
  await app.evaluate(()=>{globalThis.__answer=0;});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await until(()=>page.isClosed(),'close save');assert.ok((await fs.readFile(file,'utf8')).includes('int file_b;'));
  pass('per-document undo isolation, settings/source restart persistence and native close cancel/save');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({platform:process.platform,checks},null,2));console.log('ALL EDITOR CHECKS PASSED ('+checks.length+' groups)');
 }catch(error){
  if(page&&!page.isClosed()){console.error('EDITOR SOURCE',JSON.stringify((await text()).slice(0,1500)));console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});}
  throw error;
 }finally{
  await app.evaluate(()=>{globalThis.__answer=1;}).catch(()=>{});await app.close().catch(()=>{});
  await restoreClipboard();await fs.rm(temporary,{recursive:true,force:true});
 }
}
module.exports={runEditorScenario};
if(require.main===module){
 const {_electron}=require('playwright');
 runEditorScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(e=>{console.error(e);process.exitCode=1;});
}
