import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Storage} from '../core/storage';import {defaultConfig,defaultProblem} from '../shared/defaults';
import {workspacePackage} from '../shared/workspace';import {prepareWorkspaceProject,submissionZip,fingerprint} from '../core/submission';
import {archiveSnapshot,restorePackage} from '../core/project-archive';import {directorySnapshot} from '../core/workspace-files';
import {Compiler} from '../core/compiler';import {judge} from '../core/judge';
test('binary resources survive project export, reconstruction, execution and result identity',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-binary-')),bytes=Buffer.from([0,255,13,10,128,1]),config=defaultConfig();
 const compiler=new Compiler({toolchain:path.resolve('../.work/toolchains/linux-x64'),checkers:path.resolve('../.work/checkers/linux-x64')});
 try{
  const storage=new Storage(root);await storage.init();
  const source='#include <stdio.h>\nint main(void){FILE*f=fopen("data.bin","rb");if(!f)return 2;int sum=0,c;while((c=fgetc(f))!=EOF)sum+=c;fclose(f);printf("%d\\n",sum);}\n';
  const problem={...defaultProblem('Binary',''),testCases:[{id:'one',input:'',expectedOutput:'407\n'}]};
  const initial={files:{'LPMake.txt':'target("app")\nadd_files("./*.c")\nset_standard("c17")\n','main.c':source},binaryFiles:{'data.bin':bytes.toString('base64')}};
  const pkg=workspacePackage('Binary',initial,problem);await storage.workspace.create('Binary','c',pkg);
  assert.deepEqual(await readFile(path.join(storage.workspace.root('Binary'),'data.bin')),bytes);
  const snapshot=await storage.workspace.snapshot('Binary');assert.equal(snapshot.binaryFiles?.['data.bin'],bytes.toString('base64'));
  const loaded=await storage.workspace.open('Binary','main.c'),draft={...loaded,workspace:snapshot};
  const submission=await prepareWorkspaceProject(storage,draft,config,[],true),zip=await archiveSnapshot(Buffer.from(submissionZip(submission)));
  assert.equal(zip.binaryFiles?.['data.bin'],bytes.toString('base64'));
  const restored=restorePackage(zip.files,zip.binaryFiles) as any;restored.labId='Restored';await storage.workspace.create('Restored','c',restored);
  assert.deepEqual(await readFile(path.join(storage.workspace.root('Restored'),'data.bin')),bytes);
  const changed={...draft,workspace:{...snapshot,binaryFiles:{'data.bin':Buffer.from([1]).toString('base64')}}};
  assert.notEqual(fingerprint(draft,config.compiler,'tool'),fingerprint(changed,config.compiler,'tool'));
  const gcc={...config.compiler,mode:'custom' as const,kind:'gcc' as const,cPath:'/usr/bin/gcc',cppPath:'/usr/bin/g++'};
  const result=await judge(compiler,draft,gcc);assert.equal(result.cases[0].verdict,'AC',result.error??result.compilation?.stderr);
 }finally{await compiler.dispose();await rm(root,{recursive:true,force:true});}
});
test('managed build outputs are omitted from source snapshots while user build folders are retained',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-snapshot-'));
 try{
  await mkdir(path.join(root,'build'));await writeFile(path.join(root,'build/notes.txt'),'keep');
  assert.equal((await directorySnapshot(root)).files['build/notes.txt'],'keep');
  await writeFile(path.join(root,'build/.labpad-build.json'),JSON.stringify({kind:'labpad.build',schemaVersion:1}));
  assert.equal(Object.keys((await directorySnapshot(root)).files).length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
