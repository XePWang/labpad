import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {FileService,FileConflict,compactSelection} from '../core/files';
test('workspace file batches preserve bytes, resolve conflicts and guard the root',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-files-'));
 try{
  await mkdir(path.join(root,'src'));await writeFile(path.join(root,'src/a.bin'),Buffer.from([0,255,1,128,13,10]));
  await writeFile(path.join(root,'LPMake.txt'),'target("app")');await writeFile(path.join(root,'.labpad-project.json'),'{}');
  const service=new FileService(root,{protected:['LPMake.txt']});
  assert.deepEqual(compactSelection(['src','src/a.bin']),['src']);
  await assert.rejects(service.resolve('../outside'),/超出/);await assert.rejects(service.resolve('/tmp'),/相对/);
  await assert.rejects(service.operate({action:'delete',paths:['LPMake.txt']}),/管理/);
  await service.operate({action:'newFolder',paths:['copy']});
  await service.operate({action:'copy',paths:['src','src/a.bin'],destination:'copy'});
  assert.deepEqual(await readFile(path.join(root,'copy/src/a.bin')),Buffer.from([0,255,1,128,13,10]));
  await assert.rejects(service.operate({action:'copy',paths:['src'],destination:'copy'}),FileConflict);
  await service.operate({action:'copy',paths:['src'],destination:'copy',conflict:'keepBoth'});
  assert.ok((await service.list()).some(e=>e.path==='copy/src (2)/a.bin'));
  await assert.rejects(service.operate({action:'move',paths:['src'],destination:'src'}),/自身/);
  await assert.rejects(service.operate({action:'newFile',paths:['SRC/other.c']}),/大小写/);
  await service.operate({action:'rename',paths:['src/a.bin'],destination:'src/A.bin'});
  assert.deepEqual(await readFile(path.join(root,'src/A.bin')),Buffer.from([0,255,1,128,13,10]));
  assert.ok(!(await service.list()).some(e=>e.path==='.labpad-project.json'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failed file metadata commit rolls back replacements and debug guards run first',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-files-'));
 try{
  await mkdir(path.join(root,'to'));await writeFile(path.join(root,'a.c'),'new');await writeFile(path.join(root,'to/a.c'),'old');
  const service=new FileService(root,{commit:async()=>{throw Error('metadata write failed');}});
  await assert.rejects(service.operate({action:'move',paths:['a.c'],destination:'to',conflict:'replace'}),/metadata/);
  assert.equal(await readFile(path.join(root,'a.c'),'utf8'),'new');assert.equal(await readFile(path.join(root,'to/a.c'),'utf8'),'old');
  assert.ok(!(await readdir(root)).some(n=>n.startsWith('.labpad-txn-')));
  const guarded=new FileService(root,{guard:async()=>{throw Error('end debug first');}});
  await assert.rejects(guarded.operate({action:'delete',paths:['a.c']}),/debug first/);
  assert.equal(await readFile(path.join(root,'a.c'),'utf8'),'new');
  if(process.platform!=='win32'){await symlink(os.tmpdir(),path.join(root,'outside'));await assert.rejects(service.resolve('outside/x'),/符号链接/);await assert.rejects(service.operate({action:'copy',paths:['outside'],destination:'to'}),/符号链接/);}
 }finally{await rm(root,{recursive:true,force:true});}
});
