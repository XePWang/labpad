import {readFile,readdir,stat,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd(),require=createRequire(path.join(root,'package.json'));
const packageData=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const queue=Object.keys(packageData.dependencies),seen=new Set(),sections=[];
while(queue.length){
 const name=queue.shift();if(seen.has(name))continue;seen.add(name);
 let file;
 try{file=require.resolve(name+'/package.json');}
 catch{
  let dir=path.dirname(require.resolve(name));
  while(dir!==path.dirname(dir)){
   try{const d=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));if(d.name===name){file=path.join(dir,'package.json');break;}}catch{}
   dir=path.dirname(dir);
  }
 }
 if(!file)throw new Error('Cannot find package metadata for '+name);
 const data=JSON.parse(await readFile(file,'utf8')),directory=path.dirname(file);
 queue.push(...Object.keys(data.dependencies||{}));
 const texts=[];
 for(const entry of await readdir(directory)){
  if(/^(license|copying|notice)/i.test(entry)&&(await stat(path.join(directory,entry))).isFile())
   texts.push(await readFile(path.join(directory,entry),'utf8'));
 }
 sections.push('=== '+name+' '+data.version+' ('+JSON.stringify(data.license)+') ===\n'+texts.join('\n'));
}
sections.unshift('LabPad third-party notices\n\n'+await readFile('THIRD_PARTY_NOTICES.md','utf8')+'\n\n=== electron-vite-vue ===\n'+await readFile('TEMPLATE-LICENSE','utf8'));
await mkdir('../.work/build/licenses',{recursive:true});
await writeFile('../.work/build/licenses/THIRD_PARTY_LICENSES.txt',sections.join('\n\n')+'\n');
await writeFile('../.work/build/licenses/LabPad-MIT.txt',await readFile('../LICENSE','utf8'));
console.log('Collected notices for '+seen.size+' runtime packages');
