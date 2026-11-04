import {test,expect} from '@playwright/test';
import {_electron} from 'playwright';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
test('terminal keeps submitted input, output fragments and history through prompt redraws',async()=>{
 const evidence=path.resolve('../.work/dev9-terminal-render');await mkdir(evidence,{recursive:true});
 const contents=[
 "import {Terminal} from '@xterm/xterm';import {Readline} from './vendor/xterm-readline/src/readline';",
 "const term=new Terminal({allowProposedApi:true,cols:64,rows:12,scrollback:5000});term.open(document.body);const readline=new Readline();term.loadAddon(readline);",
 "const inputs=[];let active=true;async function loop(){while(active){try{inputs.push(await readline.read('> '));}catch{return;}}}void loop();",
 "Object.assign(window,{term,readline,inputs,lines:()=>Array.from({length:term.buffer.active.length},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true)).join('\\n')});"
 ].join('\n');
 await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,outfile:path.join(evidence,'entry.js')});
 await writeFile(path.join(evidence,'index.html'),'<!doctype html><body><script src="entry.js"></script>');
 await writeFile(path.join(evidence,'main.cjs'),"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({width:800,height:500});win.loadFile(__dirname+'/index.html');});");
 const app=await _electron.launch({args:[path.join(evidence,'main.cjs')]});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>Boolean((window as any).readline));
  const result=await page.evaluate(async()=>{
   const w=window as any,{term,readline,inputs}=w,wait=(ms=12)=>new Promise(r=>setTimeout(r,ms));await wait();
   let queue=Promise.resolve();const out=(s:string)=>queue=queue.then(()=>readline.writeAbove(s));
   for(let i=0;i<40;i++){
    term.input('INPUT_'+i,true);term.input('\r',true);
    out('OUT_'+i);out('_tail');out('\r\n');
    if(i%2===0){term.resize(23,8);await wait(1);term.resize(64,12);}
    await queue;await wait();
   }
   await wait();const screen=w.lines(),submitted=[...inputs];
   term.input('\x1b[A',true);await wait();const history=readline.getLine();
   readline.resetHistory(1024);await wait();const resetScreen=w.lines();
   return {screen,submitted,history,resetScreen};
  });
  expect(result.submitted).toEqual(Array.from({length:40},(_,i)=>'INPUT_'+i));
  for(let i=0;i<40;i++){expect(result.screen).toContain('> INPUT_'+i);expect(result.screen).toContain('OUT_'+i+'_tail');}
  expect(result.history).toBe('INPUT_39');expect(result.resetScreen).toContain('> INPUT_0');
  const queued=await page.evaluate(async()=>{
   const w=window as any,{term,readline}=w;readline.abortRead();await new Promise(r=>setTimeout(r,20));readline.holdInput(true);const commands:string[]=[];
   void(async()=>{for(let i=0;i<20;i++){commands.push(await readline.read('./ > '));await new Promise(r=>setTimeout(r,20));}})();
   for(let i=0;i<20;i++){term.input('CMD_'+i,true);term.input('\r',true);}
   const start=Date.now();while(commands.length<20&&Date.now()-start<3000)await new Promise(r=>setTimeout(r,20));return {commands,screen:w.lines()};
  });
  expect(queued.commands).toEqual(Array.from({length:20},(_,i)=>'CMD_'+i));for(let i=0;i<20;i++)expect(queued.screen).toContain('./ > CMD_'+i);
  await writeFile(path.join(evidence,'queued.json'),JSON.stringify(queued,null,2));
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
  await page.screenshot({path:path.join(evidence,'terminal.png')});
 }finally{await app.close();}
});
