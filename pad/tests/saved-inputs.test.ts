import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Storage} from '../core/storage';
import {directorySnapshot,hasUnsavedSnapshotFiles} from '../core/workspace-files';

test('saved build inputs ignore excluded rule JSON and managed outputs while retaining header and GBK resource checks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-saved-snapshot-'));
 try{
  const storage=new Storage(root);await storage.init();
  await storage.importProject({schemaVersion:1,kind:'labpad.project',labId:'练习',problems:[{problemId:'one',source:'#include "value.h"\nint main(void){return VALUE;}'}]});
  const draft=await storage.load('练习','one','c',true),dir=storage.paths('练习','one','c').dir;
  await writeFile(path.join(dir,'value.h'),'#define VALUE 0\n');
  await writeFile(path.join(dir,'notes.txt'),Buffer.from([0xc4,0xe3,0xba,0xc3]));
  const rule=await storage.openFile('练习','one','one.json'),header=await storage.openFile('练习','one','value.h'),resource=await storage.openFile('练习','one','notes.txt');
  const rulePath=path.join(dir,'one.json');await writeFile(rulePath,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),await readFile(rulePath)]));
  const {snapshot}=await storage.sourceSnapshot(draft);
  assert.equal(Object.hasOwn(snapshot.files,'one.json'),false);
  assert.equal(Object.hasOwn(snapshot.binaryFiles??{},'one.json'),false);
  assert.equal(resource.source,'你好');
  assert.ok(snapshot.binaryFiles?.['notes.txt']);
  assert.equal(hasUnsavedSnapshotFiles(snapshot,[rule,header,resource]),false);
  assert.equal(hasUnsavedSnapshotFiles(snapshot,[{...rule,source:rule.source+'\n'}]),false);
  assert.equal(hasUnsavedSnapshotFiles(snapshot,[{...header,source:'#define VALUE 1\n'}]),true);
  assert.equal(hasUnsavedSnapshotFiles(snapshot,[{...resource,source:'您好'}]),true);
  await mkdir(path.join(dir,'build'));
  await writeFile(path.join(dir,'build/.labpad-build.json'),JSON.stringify({kind:'labpad.build',schemaVersion:1}));
  await writeFile(path.join(dir,'build/log.txt'),'compiler output\n');
  const whole=await directorySnapshot(dir);
  assert.equal(Object.hasOwn(whole.files,'build/log.txt'),false);
  assert.equal(hasUnsavedSnapshotFiles(whole,[{file:'build/log.txt',source:'compiler output\n'}]),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('project text resources preserve their encoding in pending snapshots and atomic saves',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-project-saved-resource-'));
 try{
  const storage=new Storage(root);await storage.init();await storage.workspace.create('项目','c');
  const dir=storage.workspace.root('项目'),file=path.join(dir,'notes.txt'),original=Buffer.from([0xc4,0xe3,0xba,0xc3]);
  await writeFile(file,original);
  await mkdir(path.join(dir,'build'));
  await writeFile(path.join(dir,'build/.labpad-build.json'),JSON.stringify({kind:'labpad.build',schemaVersion:1}));
  await writeFile(path.join(dir,'build/log.txt'),'build output\n');
  const resource=await storage.workspace.open('项目','notes.txt'),output=await storage.workspace.open('项目','build/log.txt');
  const clean=await storage.workspace.snapshot('项目',[resource,output]);
  assert.deepEqual(Buffer.from(clean.binaryFiles!['notes.txt'],'base64'),original);
  assert.equal(Object.hasOwn(clean.files,'build/log.txt'),false);
  const edited={...resource,source:'您好'},changed=Buffer.from([0xc4,0xfa,0xba,0xc3]);
  const pending=await storage.workspace.snapshot('项目',[edited,output]);
  assert.deepEqual(Buffer.from(pending.binaryFiles!['notes.txt'],'base64'),changed);
  assert.equal(hasUnsavedSnapshotFiles(clean,[edited]),true);
  await storage.workspace.save(edited);
  assert.deepEqual(await readFile(file),changed);
  assert.equal(hasUnsavedSnapshotFiles(await storage.workspace.snapshot('项目'),[edited]),false);
  const metadata=await readFile(storage.workspace.metadata('项目'));
  await assert.rejects(storage.workspace.save({...edited,source:'🙂'}),/GBK/);
  assert.deepEqual(await readFile(file),changed);
  assert.deepEqual(await readFile(storage.workspace.metadata('项目')),metadata);
 }finally{await rm(root,{recursive:true,force:true});}
});
