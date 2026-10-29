import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const directory=path.dirname(require.resolve('node-pty/package.json'));
try{require('node-pty');console.log('node-pty native module ready');}
catch{
 const candidate=path.resolve(path.dirname(process.execPath),'../');
 const args=[require.resolve('node-gyp/bin/node-gyp.js'),'rebuild','--directory='+directory];
 if(existsSync(path.join(candidate,'include/node/node_api.h')))args.push('--nodedir='+candidate);
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
const clean=spawnSync(process.execPath,[path.join(directory,'scripts/post-install.js')],{stdio:'inherit'});
if(clean.status!==0)process.exit(clean.status??1);
require('node-pty');
