import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {defaultTypography,validateTypography} from '../shared/typography';
import {defaultConfig} from '../shared/defaults';
import {Storage} from '../core/storage';

test('font preferences migrate old settings and retain independent language sizes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'labpad-font-config-'));
 try{
  const old=defaultConfig();delete old.typography;
  await writeFile(path.join(root,'config.json'),JSON.stringify(old));
  const storage=new Storage(root),config=await storage.init();
  assert.deepEqual(config.typography,defaultTypography());
  config.typography={englishFamily:'Consolas',chineseFamily:'Microsoft YaHei',englishSize:18,chineseSize:26};
  await storage.saveConfig(config);
  assert.deepEqual((await new Storage(root).init()).typography,config.typography);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('font preferences reject malformed names and sizes',()=>{
 for(const patch of [{englishSize:0},{chineseSize:41},{chineseSize:NaN},{englishSize:12.5},{englishFamily:''},{chineseFamily:'bad\nfont'}])
  assert.throws(()=>validateTypography({...defaultTypography(),...patch}));
 assert.equal(validateTypography({...defaultTypography(),chineseFamily:'苹方-简'}).chineseFamily,'苹方-简');
});
