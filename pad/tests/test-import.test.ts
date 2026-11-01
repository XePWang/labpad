import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {defaultProblem} from '../shared/defaults';import {testPatch,parseIOPatch,parseProjectTests,mergeTests,exportIO,exportProjectTests} from '../shared/test-import';import {Storage} from '../core/storage';
test('append materializes incoming comparison without changing existing points; IDs remain unique',()=>{
 const current={...defaultProblem('L','P'),comparison:{type:'strictText'} as const,timeLimitMs:2500,testCases:[{id:'1',input:'',expectedOutput:' x'}]};
 const patch=testPatch({comparison:{type:'floatTokens',absoluteTolerance:1e-5,relativeTolerance:1e-5},timeLimitMs:1,testCases:[{id:'1',input:'2',expectedOutput:'2'},{id:'1-2',input:'3',expectedOutput:'3',comparison:{type:'wcmp'}}]});
 const {problem,renamed}=mergeTests(current,patch,'append');assert.equal(problem.timeLimitMs,2500);assert.equal(problem.comparison.type,'strictText');assert.equal(problem.testCases[0].comparison,undefined);assert.equal(problem.testCases[1].comparison?.type,'floatTokens');assert.equal(problem.testCases[2].comparison?.type,'wcmp');assert.deepEqual(problem.testCases.map(t=>t.id),['1','1-2','1-2-2']);assert.equal(renamed.length,2);assert.equal(mergeTests(current,patch,'append',true).problem.timeLimitMs,1);assert.equal(current.testCases.length,1);
});
test('project patch extraction preserves absent limits, source and empty test intent',()=>{
 const p=parseProjectTests({schemaVersion:1,kind:'labpad.project',labId:'L',problems:[{problemId:'P',source:'template',testCases:[]},{problemId:'Q',comparison:{type:'wcmp'}}]});
 assert.deepEqual(p.problems![0].rules,{testCases:[]});assert.equal(Object.hasOwn(p.problems![1].rules,'testCases'),false);
 const current={...defaultProblem('L','P'),timeLimitMs:4321};assert.equal(mergeTests(current,p.problems![0].rules,'replace').problem.timeLimitMs,4321);
 assert.throws(()=>parseProjectTests({schemaVersion:2,kind:'labpad.projectTests',labId:'L',problems:[{problemId:'P'},{problemId:'p'}]}),/唯一|重复/);
});
test('single/project tests roundtrip retains order and per-case comparison; wrong identity rejected',()=>{
 const p={...defaultProblem('L','P'),testCases:[{id:'a',input:'1',expectedOutput:'1',comparison:{type:'floatTokens',absoluteTolerance:1e-5} as const}]};
 assert.deepEqual(mergeTests(p,parseIOPatch(exportIO(p),p),'replace').problem,p);
 const all=parseProjectTests(exportProjectTests('L',[p]));assert.deepEqual(all.problems![0].rules.testCases,p.testCases);
 assert.throws(()=>parseIOPatch({...exportIO(p),problemId:'Q'},p),/题号不符/);assert.throws(()=>testPatch({testCases:[{id:'a',input:'',expectedOutput:''},{id:'a',input:'',expectedOutput:''}]}),/唯一|重复/);
});
test('batch test update preserves source bytes and metadata; invalid target leaves all rules unchanged',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-import-'));const storage=new Storage(root);
 try{
  await storage.init();await storage.importProject({schemaVersion:1,kind:'labpad.project',labId:'L',problems:[{problemId:'P',source:'original P'},{problemId:'Q',source:'original Q'}]});
  const source=await readFile(path.join(root,'projects/L/P.c')),meta=await readFile(path.join(root,'projects/L/.labpad'));
  const p=(await storage.load('L','P','c')).problem,q=(await storage.load('L','Q','c')).problem;
  await assert.rejects(storage.updateProjectTests('L',[{...p,timeLimitMs:123},{...q,problemId:'missing'}]));
  assert.equal((await storage.load('L','P','c')).problem.timeLimitMs,p.timeLimitMs);
  await storage.updateProjectTests('L',[{...p,timeLimitMs:123},{...q,testCases:[{id:'1',input:'',expectedOutput:'ok'}]}]);
  assert.equal((await storage.load('L','P','c')).problem.timeLimitMs,123);assert.equal((await storage.load('L','Q','c')).problem.testCases.length,1);
  assert.deepEqual(await readFile(path.join(root,'projects/L/P.c')),source);assert.deepEqual(await readFile(path.join(root,'projects/L/.labpad')),meta);
 }finally{await rm(root,{recursive:true,force:true});}
});
