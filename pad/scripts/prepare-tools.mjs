import {readFile,writeFile,mkdir,access,rename,chmod} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const pad=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const work=path.resolve(pad,'../.work');
const pin=JSON.parse(await readFile(path.join(pad,'toolchains.json'),'utf8'));
const host=(process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux')+'-'+process.arch;
const requested=process.argv.slice(2);const checkersOnly=requested.includes('--checkers-only');
const selected=requested.filter(t=>t!=='--checkers-only');
const targets=selected.length?selected:[host];
const supported={'linux-x64':'x86_64-linux','win-x64':'x86_64-windows','mac-arm64':'aarch64-macos'};
const triples={'linux-x64':'x86_64-linux-musl','win-x64':'x86_64-windows-gnu','mac-arm64':'aarch64-macos'};
if(!supported[host]||targets.some(t=>!supported[t]))throw new Error('Supported targets: '+Object.keys(supported).join(', '));
async function exists(file){try{await access(file);return true;}catch{return false;}}
async function download(url,destination){
 await mkdir(path.dirname(destination),{recursive:true});
 console.log('Download '+path.basename(destination));
 const response=await fetch(url,{signal:AbortSignal.timeout(900000)});
 if(!response.ok)throw new Error('Download failed '+response.status+' '+url);
 const temporary=destination+'.part';
 await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
 await rename(temporary,destination);
}
async function sha256(file){
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
const index=await (await fetch('https://ziglang.org/download/index.json')).json();
const zig=index[pin.zigVersion];if(!zig)throw new Error('Pinned Zig release not found');
async function toolchain(target){
 const directory=path.join(work,'toolchains',target),executable=path.join(directory,target.startsWith('win')?'zig.exe':'zig');
 if(await exists(executable))return directory;
 const release=zig[supported[target]],archive=path.join(work,'downloads',path.basename(release.tarball));
 if(!await exists(archive))await download(release.tarball,archive);
 if(await sha256(archive)!==release.shasum)throw new Error('Toolchain archive checksum mismatch: '+archive);
 const unpack=path.join(work,'downloads','unpack-'+target);await mkdir(unpack,{recursive:true});
 const zip=archive.endsWith('.zip');
 const extracted=zip&&process.platform==='linux'?spawnSync('unzip',['-q',archive,'-d',unpack],{stdio:'inherit'}):
  spawnSync('tar',['-xf',archive,'-C',unpack],{stdio:'inherit'});
 if(extracted.status!==0)throw new Error('Cannot unpack '+archive);
 const folder=path.basename(archive).replace(/\.tar\.xz$|\.zip$/,'');
 await mkdir(path.dirname(directory),{recursive:true});await rename(path.join(unpack,folder),directory);
 console.log('Toolchain ready: '+target);return directory;
}
const vendor=path.join(pad,'vendor/testlib');await mkdir(vendor,{recursive:true});
for(const name of ['testlib.h','LICENSE','checkers/wcmp.cpp']){
 const file=path.join(vendor,name);
 if(!await exists(file))await download('https://raw.githubusercontent.com/MikeMirzayanov/testlib/'+pin.testlibRevision+'/'+name,file);
}
await writeFile(path.join(vendor,'UPSTREAM.json'),JSON.stringify({
 repository:'https://github.com/MikeMirzayanov/testlib',revision:pin.testlibRevision
},null,2)+'\n');
await toolchain(host);
if(!checkersOnly)await Promise.all([...new Set(targets)].filter(t=>t!==host).map(toolchain));
const executable=path.join(work,'toolchains',host,process.platform==='win32'?'zig.exe':'zig');
const env={...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(work,'zig-cache'),ZIG_LOCAL_CACHE_DIR:path.join(work,'zig-cache')};
await mkdir(env.ZIG_GLOBAL_CACHE_DIR,{recursive:true});
for(const target of targets){
 const output=path.join(work,'checkers',target);await mkdir(output,{recursive:true});
 const suffix=target.startsWith('win')?'.exe':'';
 for(const [name,source] of [['wcmp',path.join(vendor,'checkers/wcmp.cpp')],['float-tokens',path.join(pad,'checkers/float-tokens.cpp')]]){
  console.log('Build '+name+' for '+target);
  const r=spawnSync(executable,['c++','-std=c++17','-O2','-I',vendor,'-target',triples[target],source,'-o',path.join(output,name+suffix)],{stdio:'inherit',env});
  if(r.status!==0)throw new Error('Checker build failed: '+target);
  if(!target.startsWith('win'))await chmod(path.join(output,name),0o755);
 }
 if(target.startsWith('win')){
  const r=spawnSync(executable,['cc','-O2','-target',triples[target],'-municode',path.join(pad,'native/process-host.c'),'-o',path.join(output,'process-host.exe')],{stdio:'inherit',env});
  if(r.status!==0)throw new Error('Windows process host build failed');
 }
 await writeFile(path.join(output,'build-info.json'),JSON.stringify({target,zig:pin.zigVersion,testlib:pin.testlibRevision},null,2)+'\n');
}
console.log('Toolchains and checkers ready.');
