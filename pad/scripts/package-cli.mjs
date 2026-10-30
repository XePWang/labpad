import {readFile,mkdir,mkdtemp,cp,writeFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const pkg=JSON.parse(await readFile('package.json','utf8')),output=path.resolve(process.argv[2]??'../.work/release');
await mkdir(output,{recursive:true});
const temporary=await mkdtemp(path.resolve('../.work/cli-package-')),name='LabPad-cli-'+pkg.version+'-linux-x64',root=path.join(temporary,name);
try{
 await mkdir(path.join(root,'resources'),{recursive:true});
 await cp('../.work/build/cli/labpad.cjs',path.join(root,'labpad.cjs'));
 await cp('../.work/checkers/linux-x64',path.join(root,'resources/checkers'),{recursive:true});
 await cp('../.work/build/licenses',path.join(root,'licenses'),{recursive:true});
 await writeFile(path.join(root,'labpad'),'#!/usr/bin/env sh\nexec node "$(dirname "$0")/labpad.cjs" "$@"\n');await chmod(path.join(root,'labpad'),0o755);
 await writeFile(path.join(root,'README.md'),'# LabPad CLI '+pkg.version+'\n\n需要 Node.js 22+、GCC/G++ 或 Zig。批量测试默认需要 Linux Bubblewrap。\n\n./labpad --help\n./labpad grade /path/to/lab2\n\n助教指南：https://github.com/XePWang/labpad/blob/main/doc/'+pkg.version+'/ta-guide.md\n');
 const file=path.join(output,'LabPad-'+pkg.version+'-cli-linux-x64.tar.gz'),result=spawnSync('tar',['-czf',file,'-C',temporary,name],{stdio:'inherit'});
 if(result.status!==0)throw Error('CLI archive failed');console.log(file);
}finally{await rm(temporary,{recursive:true,force:true});}
