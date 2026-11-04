import {parseTemplates,type SourceTemplates} from './templates';
import {defaultProblem,defaultSource,defaultStandards,defaultWarnings} from './defaults';import {filePart,validateProblem} from './validate';import {parse,ConfigError} from './lpmake';import {testPatch,rulesOf} from './test-import';import type {Language,Problem,CompilerConfig} from './types';import type {CheckRecord} from './project-format';
export interface WorkspaceSnapshot{files:Record<string,string>;binaryFiles?:Record<string,string>;inheritDefaults?:boolean}
export interface WorkspaceFile{path:string;directory:boolean}
export interface WorkspaceState{debugView?:{breakpoints:import('./debug').SourceBreakpoint[];watches:string[]};templates?:SourceTemplates;schemaVersion:2;mode:'project';labId:string;tests:Problem;inheritDefaults?:boolean;starters?:Record<string,string>;activeFile?:string;openFiles?:string[];expanded?:string[];sidebarWidth?:number;sidebarCollapsed?:boolean;rightCollapsed?:boolean;check?:CheckRecord}
export interface WorkspacePackage{templateFilled?:boolean;templates?:SourceTemplates;schemaVersion:2;kind:'labpad.project';mode:'project';labId:string;build:{system:'lpmake';file:'LPMake.txt';inheritDefaults?:boolean};tests:Problem;files:{path:string;content:string;encoding?:'base64'}[]}
export interface ProjectBuildOptions{inheritDefaults:boolean;cArgs:string[];cppArgs:string[];linkArgs:string[]}
export function workspacePath(value:unknown){
 if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/'))throw new Error('请使用项目内相对路径，以 / 分隔文件夹');
 const parts=value.split('/');for(const part of parts)filePart(part,'文件名');
 if(parts.some(p=>['.git','.work','.labpad-project.json','labpad.project.json'].includes(p.toLowerCase())))throw new Error('该路径由LabPad保留');
 return parts.join('/');
}
export function uniquePaths(paths:string[]){
 const directories=new Map<string,string>();for(const value of paths){const parts=workspacePath(value).split('/');for(let i=1;i<parts.length;i++){const prefix=parts.slice(0,i).join('/'),key=prefix.normalize('NFC').toLowerCase(),old=directories.get(key);if(old&&old!==prefix)throw new Error('文件夹名称跨平台冲突：'+old+' / '+prefix);directories.set(key,prefix);}}
 const seen=new Map<string,string>();for(const value of paths){const p=workspacePath(value),key=p.normalize('NFC').toLowerCase();if(seen.has(key))throw new Error('文件名跨平台冲突：'+seen.get(key)+' / '+p);seen.set(key,p);}
 for(const p of paths){let parent=p;while(parent.includes('/')){parent=parent.slice(0,parent.lastIndexOf('/'));if(seen.has(parent.normalize('NFC').toLowerCase()))throw new Error('文件与文件夹冲突：'+parent);}}
}
export function defaultLpmake():string{return '# LabPad 项目构建配置\n'+'target("app")\nset_standard("c17")\nset_standard("c++20")\nset_mode("debug")\n\nadd_includedirs("./")\nadd_files("./*.c", "./*.cpp")\n\nadd_cflags('+defaultWarnings.map(v=>JSON.stringify(v)).join(', ')+')\nadd_cxxflags('+defaultWarnings.map(v=>JSON.stringify(v)).join(', ')+')\nadd_links("m")\n';}
export function workspaceTemplate(language:Language='c'):Record<string,string>{
 const suffix=language==='c'?'c':'cpp';return {'LPMake.txt':defaultLpmake(),['main.'+suffix]:defaultSource(language)};
}
export function parseWorkspacePackage(value:unknown):WorkspacePackage{
 const p=value as any;if(!p||p.schemaVersion!==2||p.kind!=='labpad.project'||p.mode!=='project')throw new Error('请选择schemaVersion为2、mode为project的实验项目');
 const labId=filePart(p.labId,'项目名称');if(p.build!==undefined&&(p.build?.system!=='lpmake'||p.build?.file!=='LPMake.txt'))throw new Error('构建配置必须使用 LPMake.txt');
 if(p.build?.inheritDefaults!==undefined&&typeof p.build.inheritDefaults!=='boolean')throw new Error('inheritDefaults应为布尔值');
 if(!Array.isArray(p.files))throw new Error('项目缺少 files 文件清单');
 const files=p.files.map((f:any)=>{const name=workspacePath(f?.path),content=f.content;if(typeof content!=='string')throw new Error('缺少文件内容：'+name);if(f.encoding!==undefined&&f.encoding!=='base64')throw new Error('文件编码无效：'+name);if(f.encoding==='base64'&&(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)||/\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(name)||name==='LPMake.txt'))throw new Error('源码和构建配置须为文本，资源请使用有效 base64：'+name);return {path:name,content,...(f.encoding?{encoding:f.encoding}:{})};});
 uniquePaths(files.map((f:{path:string})=>f.path));const make=files.find((f:{path:string})=>f.path==='LPMake.txt');if(!make)files.unshift({path:'LPMake.txt',content:defaultLpmake()});else parse(make.content);
 const tests=validateProblem({...defaultProblem(labId,''),...testPatch(p.tests??{},labId,''),labId,problemId:''});
 const templates=parseTemplates(p.templates);return {...(templates?{templates}:{}),...(!make?{templateFilled:true}:{}),schemaVersion:2,kind:'labpad.project',mode:'project',labId,build:{system:'lpmake',file:'LPMake.txt',...(p.build?.inheritDefaults!==undefined?{inheritDefaults:p.build.inheritDefaults}:{})},files,tests};
}
export function workspacePackage(labId:string,snapshot:WorkspaceSnapshot,tests:Problem,templates?:SourceTemplates):WorkspacePackage{
 return {...(templates?{templates}:{}),schemaVersion:2,kind:'labpad.project',mode:'project',labId,build:{system:'lpmake',file:'LPMake.txt'},tests:structuredClone(tests),files:[...Object.entries(snapshot.files).map(([path,content])=>({path,content})),...Object.entries(snapshot.binaryFiles??{}).map(([path,content])=>({path,content,encoding:'base64' as const}))]};
}
export function effectiveCompiler(base:CompilerConfig,options?:ProjectBuildOptions):CompilerConfig{
 return !options||options.inheritDefaults?structuredClone(base):{...structuredClone(base),cArgs:[...options.cArgs],cppArgs:[...options.cppArgs],linkArgs:[...options.linkArgs]};
}

export interface WorkspaceEdit {action:'newFile'|'newFolder'|'rename';file:string;name:string;template?:boolean;syncReferences?:boolean}
