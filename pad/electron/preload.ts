import {contextBridge,ipcRenderer} from 'electron';
import {operationError} from '../shared/errors';
import type {Bridge} from '../shared/types';
function listen(channel:string,callback:(value:any)=>void){const handler=(_event:unknown,value:unknown)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);}
async function invoke(channel:string,...args:unknown[]){try{return await ipcRenderer.invoke(channel,...args);}catch(e){throw new Error(operationError(e));}}
const api:Bridge={
 copyText:text=>invoke('clipboard:write',text),
 recentSource:(a,b,c)=>invoke('source:recent',a,b,c),exportChoices:d=>invoke('export:choices',d),exportPreview:(k,d)=>invoke('export:preview',k,d),writeExport:p=>invoke('export:write',p),checkState:d=>invoke('check:state',d),problemStates:(d,b)=>invoke('check:problems',d,b),
 openDocuments:(a,b,c)=>invoke('documents:open',a,b,c),activateDocument:id=>invoke('document:activate',id),newVersion:(d,t)=>invoke('source:version',d,t),copyPath:(v,r)=>invoke('path:copy',v,r),workspaceState:(d,s)=>ipcRenderer.send('workspace:state',d,s),
 openShortcuts:()=>invoke('shortcuts:open'),shortcutSettings:()=>invoke('shortcuts:get'),saveShortcuts:v=>invoke('shortcuts:save',v),onShortcuts:c=>listen('shortcuts:changed',c),clearCache:()=>invoke('cache:clear'),
 saveProblem:p=>invoke('problem:save',p),bootstrap:()=>invoke('bootstrap'),reloadDocument:()=>invoke('draft:reload'),saveDraft:d=>invoke('draft:save',d),formatCode:(s,l,i)=>invoke('source:format',s,l,i),documentState:(d,s)=>ipcRenderer.send('document:state',d,s),
 loadDraft:(a,b,c,p=true)=>invoke('draft:load',a,b,c,p),projects:()=>invoke('projects'),
 createLab:n=>invoke('project:create',n),createProblem:(a,b,c)=>invoke('problem:create',a,b,c),
 saveConfig:(c,p)=>invoke('config:save',c,p),compilerInfo:c=>invoke('compiler:info',c),detectCompilers:()=>invoke('compiler:detect'),saveLayout:l=>invoke('layout:save',l),importSource:()=>invoke('source:import'),
 confirmUnsaved:()=>invoke('document:confirm'),validatePath:(p,k,e)=>invoke('path:validate',p,k,e),
 choosePath:(k,p)=>invoke('path:choose',k,p),revealPath:(p,k)=>invoke('path:reveal',p,k),
 importIO:(a,b)=>invoke('problem:import',a,b),importProject:()=>invoke('project:import'),showProblemFile:d=>invoke('problem:show',d),
 judge:(d,ids)=>invoke('judge',d,ids),cancel:()=>invoke('cancel'),debugStart:d=>invoke('debug:start',d),
 debugInput:d=>ipcRenderer.send('debug:input',d),debugResize:(c,r)=>ipcRenderer.send('debug:resize',c,r),debugStop:()=>invoke('debug:stop'),
 onJudge:c=>listen('judge:event',c),onDebugData:c=>listen('debug:data',packet=>c(packet.data,()=>ipcRenderer.send('debug:ack',packet.session,packet.data.length))),onDebugState:c=>listen('debug:state',c)
};contextBridge.exposeInMainWorld('labpad',api);
