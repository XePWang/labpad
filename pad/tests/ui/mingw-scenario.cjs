const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const until=async(fn,label,timeout=120000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw Error('Timeout: '+label);};
async function runMingwScenario(electron,{executable,evidence,bin}){
 if(process.platform!=='win32')throw Error('MinGW scenario requires Windows');
 await fs.mkdir(evidence,{recursive:true});const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'LabPad-MingW-')),env={...process.env},errors=[];
 const original=env.Path??env.PATH??'';for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.Path=bin+';'+original;env.LABPAD_DATA_DIR=path.join(temporary,'labpad');env.LABPAD_SKIP_WARMUP='1';
 const app=await electron.launch({executablePath:executable,cwd:path.dirname(executable),chromiumSandbox:true,env});let page;
 try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.toolbar').waitFor();
  const button=name=>page.getByRole('button',{name,exact:true}),editor=()=>page.locator('.cm-content');
  await page.evaluate(()=>{window.__mingwOutput='';window.labpad.onDebugData((data,ack)=>{window.__mingwOutput+=data;ack();});});
  await page.getByRole('button',{name:'⚙ 设置',exact:true}).click();await page.getByRole('combobox',{name:'编译器使用方式',exact:true}).selectOption('custom');await button('自动检测').click();await page.getByRole('heading',{name:'自动检测编译器',exact:true}).waitFor();
  const candidate=page.locator('.compiler-option').filter({hasText:bin}).filter({hasText:'GCC'}).first();await candidate.getByRole('radio').check();await button('使用此编译器').click();
  assert.equal(await page.getByRole('combobox',{name:'编译器类型',exact:true}).inputValue(),'gcc');
  assert.equal((await page.getByRole('textbox',{name:'C 编译器路径',exact:true}).inputValue()).toLowerCase(),path.join(bin,'gcc.exe').toLowerCase());
  assert.equal((await page.getByRole('textbox',{name:'C++ 编译器路径',exact:true}).inputValue()).toLowerCase(),path.join(bin,'g++.exe').toLowerCase());
  await page.getByRole('checkbox',{name:'保存时自动格式化'}).uncheck();await button('保存设置').click();await page.getByRole('dialog').waitFor({state:'hidden'});
  console.log('PASS real standalone MinGW detection, manual selection, GCC category, C/C++ paths and default flags');
  await editor().fill('#include <stdio.h>\nint main(void){char line[80];puts("你好 GCC");fflush(stdout);if(fgets(line,sizeof line,stdin))printf("收到:%s",line);return 0;}\n');await page.keyboard.press('F9');
  const input=page.getByRole('textbox',{name:'调试输入',exact:true});await until(()=>input.isEnabled(),'GCC prompt');await input.fill('中文输入');await page.keyboard.press('Enter');await until(()=>page.evaluate(()=>window.__mingwOutput.includes('收到:中文输入')),'GCC UTF8');await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'GCC ended');
  await page.locator('.bottom-panel').screenshot({path:path.join(evidence,'mingw-debug.png')});
  await page.getByRole('button',{name:/新增测试点/}).click();await page.getByRole('textbox',{name:'标准输入 1',exact:true}).fill('测试\n');await page.getByRole('textbox',{name:'预期输出 1',exact:true}).fill('你好 GCC\n收到:测试\n');await page.keyboard.press('F9');await page.locator('.verdict.ac').waitFor();await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'GCC judged');console.log('PASS standalone GCC Chinese stdout and stdin in both interactive and testcase execution');
  await button('新建源码').click();await page.getByRole('menuitem',{name:'C++ 源码（.cpp）',exact:true}).click();await editor().fill('#include <iostream>\n#include <string>\nint main(){std::string s;std::cout<<"你好 G++"<<std::endl;if(std::getline(std::cin,s))std::cout<<"收到:"<<s<<std::endl;}\n');await page.getByRole('textbox',{name:'预期输出 1',exact:true}).fill('你好 G++\n收到:测试\n');await page.keyboard.press('F9');await page.locator('.verdict.ac').waitFor();await until(()=>page.getByRole('button',{name:/编译并运行/}).isEnabled(),'G++ judged');
  assert.match(await page.getByTestId('output').textContent(),/g\+\+\.exe/);
  await editor().focus();await page.keyboard.press('Control+s');await until(()=>page.locator('.save-status').textContent().then(t=>t==='已保存'),'G++ saved');
  assert.deepEqual(errors,[]);console.log('PASS standalone G++ C++17 linking and Chinese testcase output; original setup requires no IDE or system PATH edit');
 }catch(e){if(page&&!page.isClosed()){await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});console.error(await page.locator('body').innerText());}throw e;}
 finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await fs.rm(temporary,{recursive:true,force:true});}
}
module.exports={runMingwScenario};
if(require.main===module){const {_electron}=require('playwright');runMingwScenario(_electron,{executable:path.resolve(process.argv[2]),evidence:path.resolve(process.argv[3]),bin:path.resolve(process.argv[4])}).catch(e=>{console.error(e);process.exitCode=1;});}
