import {realpath,stat} from 'node:fs/promises';import path from 'node:path';import {glob} from 'tinyglobby';
import {relative,defaults,type Spec,type Plan,type Unit,type Language} from '../../shared/lpmake';
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
export async function resolve(spec:Spec,root:string,base=defaults,inherit=true):Promise<Plan>{
 const canonical=await realpath(root);
 const inventory=await glob(['**/*'],{cwd:root,onlyFiles:true,followSymbolicLinks:false,dot:false});
 const keys=new Set<string>();for(const f of inventory){const key=f.normalize('NFC').toLowerCase();if(keys.has(key))throw Error('文件名跨平台冲突：'+f);keys.add(key);}
 const names=(await glob(spec.sources.map(relative),{cwd:root,onlyFiles:true,expandDirectories:false,followSymbolicLinks:false,ignore:spec.exclude.map(relative)})).map(p=>p.replaceAll('\\','/')).sort((a,b)=>{const x=a.normalize('NFC'),y=b.normalize('NFC');return x<y?-1:x>y?1:0;});
 if(!names.length)throw Error('没有参与构建的源文件');
 for(const pattern of spec.sources){if(!/[*?[\]{}()!]/.test(pattern)){const info=await stat(path.join(root,relative(pattern))).catch(()=>undefined);if(!info?.isFile())throw Error('源文件不存在：'+pattern);}}
 const dirs=[...new Set(spec.includeDirs.map(relative))];
 for(const d of [...dirs,...spec.linkDirs.map(relative)]){const full=await realpath(path.join(root,d));if(!inside(canonical,full)||!(await stat(full)).isDirectory())throw Error('包含/库目录不在项目内：'+d);}
 const units:Unit[]=[];
 for(const name of [...new Set(names)]){
  const full=await realpath(path.join(root,name));if(!inside(canonical,full))throw Error('源文件越出项目：'+name);
  const ext=path.extname(name).toLowerCase(),inferred:Language=ext==='.c'?'c':['.cpp','.cc','.cxx'].includes(ext)?'cpp':(()=>{throw Error('不支持的源文件扩展名：'+name)})();
  const language=spec.language??inferred,args=[...(inherit?base[language]:[])];
  if(spec.standards[language])args.push('-std='+spec.standards[language]);
  args.push(...(spec.mode==='debug'?['-g','-O0','-UNDEBUG']:['-O2','-DNDEBUG']));
  if(spec.optimize)args.push('-'+spec.optimize);
  args.push(...dirs.map(d=>'-I'+path.join(root,d)),...spec.defines.map(d=>'-D'+d),...(language==='c'?spec.cflags:spec.cxxflags));
  args.push('-x',language==='c'?'c':'c++');units.push({path:name,language,args});
 }
 return {version:1,target:spec.target,units,linkLanguage:units.some(u=>u.language==='cpp')?'cpp':'c',linkArgs:[...(inherit?base.link:[]),...spec.linkDirs.map(d=>'-L'+path.join(root,relative(d))),...spec.links.map(l=>'-l'+l),...spec.ldflags],mode:spec.mode};
}
