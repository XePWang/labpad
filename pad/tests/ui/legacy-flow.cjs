const fs=require('node:fs/promises');
const until=async(fn,label,timeout=150000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Timeout: '+label);};
// Older workflow fixtures express their intended choices using their original ordinal.
// Translate that intent to the platform's displayed label; new fixtures choose labels directly.
function wrapNativeReply(mock){return async(...args)=>{
 const options=args.at(-1),result=await mock(...args);
 const choices={'保存修改':['保存','不保存','取消'],'删除文件':['取消','删除'],'同名文件':['取消','替换'],'删除项目文件':['取消','删除'],'删除实验项目':['取消','删除整个项目'],'替换项目文件':['取消','替换'],'导入测试点':['取消','覆盖现有测试点','追加到末尾'],'测试限制':['取消','保留当前限制','采用导入限制'],'确认导入':['取消','导入'],'导入实验项目':['取消','更新测试点','导入副本'],'更新项目测试点':['取消','更新测试点'],'项目构建配置':['修改配置','忽略']};
 const label=options.title==='保存后编译'?'保存并编译':choices[options.title]?.[result.response];
 if(label){const position=options.buttons.indexOf(label);if(position<0)throw Error('Missing fixture action '+label);return {...result,response:position};}
 return {...result,response:options.cancelId??result.response};
};}
function withFixtures(electron){
 const result=Object.create(electron);result.launch=async options=>{const app=await electron.launch(options);await app.evaluate((_,source)=>{globalThis.__wrapNativeReply=Function('return ('+source+')')();},wrapNativeReply.toString());return app;};return result;
}
async function compileOnly(page,key){
 await page.evaluate(()=>{if(!window.__flowCounterInstalled){window.__flowCompiles=0;window.labpad.onJudge(e=>{if(e.type==='compilation')window.__flowCompiles++;});window.__flowCounterInstalled=true;}});
 const before=await page.evaluate(()=>window.__flowCompiles);
 if(key)await page.keyboard.press(key);else await page.getByRole('button',{name:'编译',exact:true}).click();
 await until(async()=>await page.evaluate(n=>window.__flowCompiles>n,before)||await page.locator('.phase').innerText().then(t=>t==='编译失败'),'compilation');
 await until(()=>page.locator('.phase').innerText().then(t=>!t.includes('编译中')&&!t.includes('正在启动')),'compilation settled');
}
async function ensureCompiled(page){const state=await page.evaluate(async()=>window.labpad.compileState((await window.labpad.bootstrap()).draft));if(!state.ready)await compileOnly(page);}
async function compileAndRun(page,key){
 await compileOnly(page,key);
 const target=page.locator('.cases-heading .run-test-icon');if(!await target.count()||!await target.isEnabled())return;await target.click();await until(()=>page.getByRole('button',{name:'编译',exact:true}).isEnabled(),'tests finished');
}
async function runSingle(page,trigger){await ensureCompiled(page);await trigger();}
async function selectTerminalText(page,text){
 const rows=page.locator('.xterm-rows>div');await until(async()=>(await rows.allTextContents()).some(row=>row.includes(text)),'terminal text visible',5000);const count=await rows.count();
 for(let i=0;i<count;i++){
  const row=rows.nth(i);if(!(await row.textContent()).includes(text))continue;
  const box=await row.evaluate((node,text)=>{
   const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),nodes=[];let full='',next;while(next=walker.nextNode()){nodes.push({node:next,start:full.length});full+=next.textContent;}
   const start=full.indexOf(text),end=start+text.length,range=document.createRange();for(const item of nodes){const length=item.node.textContent.length;if(start>=item.start&&start<item.start+length)range.setStart(item.node,start-item.start);if(end>item.start&&end<=item.start+length)range.setEnd(item.node,end-item.start);}const b=range.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};
  },text);
  await page.mouse.move(box.x+1,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-1,box.y+box.height/2,{steps:20});await page.mouse.up();return;
 }
 throw Error('Terminal text not visible: '+text);
}
module.exports={withFixtures,compileOnly,ensureCompiled,compileAndRun,runSingle,selectTerminalText};
