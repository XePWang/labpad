import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('desktop self-test, debug tabs, source export, rule file and persistence',async()=>{
 const root=path.resolve('..'),temporary=await mkdtemp(path.join(tmpdir(),'labpad-ui-'));
 const data=path.join(temporary,'labpad');
 const packaged=process.env.LABPAD_TEST_EXECUTABLE;
 const launch=()=>electron.launch({cwd:process.cwd(),executablePath:packaged,args:packaged?['--no-sandbox']:['.','--no-sandbox'],
  env:{...process.env,LABPAD_DATA_DIR:data}});
 let app=await launch();
 try{
  let page=await app.firstWindow();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox',{name:'学号',exact:true}).fill('12345678');
  await page.getByRole('textbox',{name:'姓名',exact:true}).fill('测试同学');
  await page.getByRole('textbox',{name:'设置实验名称'}).fill('Lab 2');
  await page.getByRole('textbox',{name:'设置题号'}).fill('Lab 2-1');
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('textbox',{name:'实验项目',exact:true})).toHaveValue('Lab 2');
  await expect(page.getByRole('textbox',{name:'题号',exact:true})).toHaveValue('Lab 2-1');
  await expect(page.locator('.toolbar input')).toHaveCount(2);
  await page.getByRole('button',{name:'新增测试点',exact:false}).click();
  const source='#include <stdio.h>\nint main(void){puts("42");return 0;}\n';
  await page.locator('.cm-content').fill(source);
  await page.getByRole('textbox',{name:'预期输出 1',exact:true}).fill('42\n');
  await page.getByRole('button',{name:'编译并运行测试点',exact:false}).click();
  await expect(page.locator('.verdict.ac')).toHaveText('AC',{timeout:150000});
  await expect(page.locator('.passed-count')).toHaveText('1 / 1 通过');
  await page.screenshot({path:path.join(root,'.work/ui-results/desktop-self-test.png'),fullPage:true});

  await page.getByRole('textbox',{name:'预期输出 1',exact:true}).fill('43');
  await page.getByRole('button',{name:'编译并运行测试点',exact:false}).click();
  await expect(page.locator('.verdict.wa')).toHaveText('WA');
  await page.getByRole('button',{name:'查看 Diff',exact:true}).click();
  await expect(page.locator('.diff-view .added')).toContainText('42');
  await expect(page.locator('.diff-view .removed')).toContainText('43');

  const exported=path.join(temporary,'12345678_Lab 2-1.c');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file}) as any;},exported);
  await page.getByRole('button',{name:'导出源码',exact:false}).click();
  await expect(page.getByRole('status')).toContainText('已导出');
  const bytes=await readFile(exported);expect(bytes.toString('utf8')).toBe(source);
  expect(bytes.subarray(0,3).toString('hex')).not.toBe('efbbbf');

  const debugSource='#include <stdio.h>\nint main(void){int n;printf("number: ");scanf("%d",&n);printf("answer: %d\\n",n*2);scanf("%d",&n);return 0;}\n';
  await page.locator('.cm-content').fill(debugSource);
  await page.evaluate(()=>{(window as any).__debug=[];window.labpad.onDebugData(d=>(window as any).__debug.push(d));});
  await page.getByRole('button',{name:'调试',exact:true}).click();
  await page.getByRole('button',{name:'编译并启动',exact:false}).click();
  await expect(page.locator('.phase')).toContainText('调试运行中',{timeout:150000});
  await expect.poll(()=>page.evaluate(()=>(window as any).__debug.join(''))).toContain('number:');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('7');await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>(window as any).__debug.join(''))).toContain('answer: 14');
  await page.getByRole('button',{name:'输出',exact:true}).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.phase')).toContainText('调试运行中');
  await page.getByRole('button',{name:'调试',exact:true}).click();
  await page.screenshot({path:path.join(root,'.work/ui-results/desktop-debug.png'),fullPage:true});
  await page.getByRole('button',{name:'停止程序',exact:false}).click();
  await expect(page.locator('.phase')).toContainText('已停止');

  const problemPath=path.join(data,'projects/Lab 2/Lab 2-1.json');
  const problem=JSON.parse(await readFile(problemPath,'utf8'));
  problem.comparison={type:'floatTokens',absoluteTolerance:.001};
  problem.testCases[0].expectedOutput='0';
  await writeFile(problemPath,JSON.stringify(problem,null,2));
  await page.getByRole('button',{name:'重新加载',exact:true}).click();
  expect((await page.evaluate(()=>window.labpad.bootstrap())).draft.problem.comparison).toEqual(problem.comparison);
  await app.close();

  app=await launch();page=await app.firstWindow();
  await expect(page.locator('.cm-content')).toContainText('number:');
  await expect(page.getByRole('dialog')).toBeHidden();
  const restored=await page.evaluate(()=>window.labpad.bootstrap());
  expect(restored.config.studentId).toBe('12345678');
  expect(restored.draft.problem.comparison).toEqual(problem.comparison);
  expect(restored.draft.problem.testCases[0].expectedOutput).toBe('0');
  expect(errors).toEqual([]);
 }finally{
  await app.close().catch(()=>{});await rm(temporary,{recursive:true,force:true});
 }
});
