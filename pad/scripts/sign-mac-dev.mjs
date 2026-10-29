import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export default async function signMacDev(context){
 if(context.electronPlatformName!=='darwin')return;
 const app=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
 const entitlements=fileURLToPath(new URL('../entitlements.dev.plist',import.meta.url));
 if(process.env.LABPAD_RCODESIGN){
  const args=['sign','--timestamp-url','none','--entitlements-xml-file',entitlements];
  const frameworks=path.join(app,'Contents/Frameworks');
  for(const name of await readdir(frameworks)){
   if(name.endsWith('.app'))args.push('--entitlements-xml-file','Contents/Frameworks/'+name+':'+entitlements);
  }
  args.push(app);
  const result=spawnSync(process.env.LABPAD_RCODESIGN,args,{stdio:'inherit'});
  if(result.status!==0)throw new Error('macOS dev ad-hoc signing failed');
 }else if(process.platform==='darwin'){
  const result=spawnSync('/usr/bin/codesign',['--force','--deep','--sign','-','--entitlements',entitlements,app],{stdio:'inherit'});
  if(result.status!==0)throw new Error('macOS dev ad-hoc signing failed');
 }else throw new Error('Cross-packaging macOS requires LABPAD_RCODESIGN pointing to rcodesign');
}
