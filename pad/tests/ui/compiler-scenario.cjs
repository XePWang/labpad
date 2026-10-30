const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
async function until(fn,label,timeout=30000){
 const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timeout: '+label);
}
async function runCompilerScenario(electron,{executable,cwd,evidence}){
 await fs.mkdir(evidence,{recursive:true});
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-compiler-中文-'));
 assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));
 const data=path.join(temporary,'labpad'),fixture=path.join(temporary,'installed zig'),errors=[],checks=[];
 const target=(process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux')+'-'+process.arch;
 const bundled=executable?path.join(path.dirname(path.resolve(executable)),'resources','toolchain'):path.resolve(cwd,'../.work/toolchains',target);
 const binary=process.platform==='win32'?'zig.exe':'zig',installed=path.join(fixture,binary);
 await fs.mkdir(fixture);await fs.copyFile(path.join(bundled,binary),installed);await fs.symlink(path.join(bundled,'lib'),path.join(fixture,'lib'),process.platform==='win32'?'junction':'dir');
 const environment={...process.env,LABPAD_DATA_DIR:data},pathKey=Object.keys(environment).find(k=>k.toLowerCase()==='path')??'PATH';
 environment[pathKey]=fixture+path.delimiter+(environment[pathKey]??'');
 const launch=()=>electron.launch({executablePath:executable,cwd,args:executable?[]:['.'],chromiumSandbox:true,env:environment});
 let app=await launch(),page;
 const button=name=>page.getByRole('button',{name,exact:true}),select=name=>page.getByRole('combobox',{name,exact:true}),input=name=>page.getByRole('textbox',{name,exact:true});
 const dialog=()=>page.getByRole('dialog',{name:'自动检测编译器',exact:true}),settingsDialog=()=>page.getByRole('dialog',{name:'设置',exact:true});
 const snapshot=()=>page.evaluate(()=>window.labpad.bootstrap());
 async function prepare(){
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.locator('.toolbar').waitFor();
  await app.evaluate(({dialog})=>{globalThis.__source='';dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});dialog.showOpenDialog=async()=>({canceled:!globalThis.__source,filePaths:[globalThis.__source]});});
 }
 async function settings(){await page.getByRole('button',{name:/设置/}).click();await settingsDialog().waitFor();}
 async function detect(){await button('自动检测').click();await dialog().waitFor({timeout:60000});}
 function pass(label){checks.push(label);console.log('PASS '+label);}
 try{
  await prepare();await settings();assert.equal(await button('自动检测').count(),0);await select('编译器使用方式').selectOption('custom');
  await select('编译器类型').selectOption('clang');await input('C 编译器路径').fill(path.join(temporary,'missing'));
  await input('C 参数').fill('-invalid-c-option');await input('C++ 参数').fill('-invalid-cpp-option');await input('链接参数').fill('-invalid-link-option');
  await detect();const choice=page.getByRole('radio',{name:'Zig '+installed,exact:true});await choice.waitFor();
  assert.equal(await button('使用此编译器').isDisabled(),true);
  assert.ok((await dialog().innerText()).includes('Zig'));
  assert.ok(!(await dialog().locator('code').allTextContents()).includes(path.join(bundled,binary)),'bundled compiler is not a custom installation');
  await page.screenshot({path:path.join(evidence,'compiler-choices.png'),fullPage:true});
  await button('取消').last().click();await dialog().waitFor({state:'hidden'});assert.equal(await select('编译器类型').inputValue(),'clang');assert.equal(await input('C 参数').inputValue(),'-invalid-c-option');
  assert.equal((await snapshot()).config.compiler.mode,'builtin');
  pass('custom-mode detection lists real installed compilers, requires manual selection, excludes bundled Zig and cancels without changes');
  await detect();await choice.check();await button('使用此编译器').click();await dialog().waitFor({state:'hidden'});
  assert.equal(await select('编译器类型').inputValue(),'zig');assert.equal(await input('C 编译器路径').inputValue(),installed);assert.equal(await input('C++ 编译器路径').inputValue(),installed);
  assert.equal(await input('C 参数').inputValue(),'-std=c17\n-O2\n-Wall\n-Wextra');assert.equal(await input('C++ 参数').inputValue(),'-std=c++17\n-O2\n-Wall\n-Wextra');assert.equal(await input('链接参数').inputValue(),'-lm');
  assert.equal((await snapshot()).config.compiler.mode,'builtin','selection waits for Save Settings');
  await until(()=>button('保存设置').isEnabled(),'selected paths validate');await button('保存设置').click();await settingsDialog().waitFor({state:'hidden'});
  const chosen=(await snapshot()).config.compiler;assert.equal(chosen.mode,'custom');assert.equal(chosen.kind,'zig');assert.equal(chosen.cPath,installed);
  pass('selected compiler resets category, both paths and matching C/C++/link defaults; settings commit explicitly');

  await page.locator('.cm-content').fill('#include <stdio.h>\nint main(void){printf("42");}\n');
  await page.getByRole('button',{name:/新增测试点/}).click();await input('预期输出 1').fill('42');await button('保存').click();await page.getByRole('menuitem',{name:'保存当前',exact:true}).click();await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'save source');
  await page.getByRole('button',{name:/编译并运行/}).click();await page.locator('.verdict.ac').waitFor({timeout:150000});
  const cpp=path.join(temporary,'external.cpp');await fs.writeFile(cpp,'#include <iostream>\nint main(){std::cout<<42;}\n');await app.evaluate((_,file)=>{globalThis.__source=file;},cpp);await button('打开源码').click();
  await until(()=>page.locator('.pane-heading').first().textContent().then(t=>t.includes('external.cpp')),'C++ source open');
  await page.getByRole('button',{name:/编译并运行/}).click();await page.locator('.verdict.ac').waitFor({timeout:150000});await button('保存').click();await page.getByRole('menuitem',{name:'保存当前',exact:true}).click();await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'save C++ source');
  pass('actual detected external Zig compiles and judges C and C++ from an installation path containing spaces and Chinese characters');
  await app.close();app=await launch();await prepare();assert.equal((await snapshot()).config.compiler.cPath,installed);
  pass('selected compiler persists across restart');
  await settings();await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('compiler:detect');ipcMain.handle('compiler:detect',()=>[]);});await detect();
  assert.equal((await dialog().getByText('LabPad在常用路径未找到可支持的编译器',{exact:true}).textContent()),'LabPad在常用路径未找到可支持的编译器');assert.equal(await page.getByRole('radio').count(),0);
  await page.screenshot({path:path.join(evidence,'compiler-not-found.png'),fullPage:true});await keyEscape();await dialog().waitFor({state:'hidden'});
  await button('取消').click();assert.equal((await snapshot()).config.compiler.cPath,installed);assert.deepEqual(errors,[]);
  pass('empty detection result shows the exact requested message, Escape closes the popup and preserves existing settings');
  await fs.writeFile(path.join(evidence,'checks.json'),JSON.stringify({platform:process.platform,checks},null,2));console.log('ALL COMPILER DETECTION CHECKS PASSED ('+checks.length+' groups)');
 }catch(error){
  if(page&&!page.isClosed()){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});}throw error;
 }finally{
  await app.close().catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});
 }
 async function keyEscape(){await page.keyboard.press('Escape');}
}
module.exports={runCompilerScenario};
if(require.main===module){
 const {_electron}=require('playwright');runCompilerScenario(_electron,{executable:path.resolve(process.argv[2]),cwd:process.cwd(),evidence:path.resolve(process.argv[3])}).catch(error=>{console.error(error);process.exitCode=1;});
}
