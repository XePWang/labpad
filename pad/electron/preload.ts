import {contextBridge,ipcRenderer} from 'electron';
import type {Bridge} from '../shared/types';
function listen(channel:string,callback:(value:any)=>void){const handler=(_event:unknown,value:unknown)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);}
const api:Bridge={
 bootstrap:()=>ipcRenderer.invoke('bootstrap'),reloadDocument:()=>ipcRenderer.invoke('draft:reload'),saveDraft:d=>ipcRenderer.invoke('draft:save',d),formatCode:(s,l,i)=>ipcRenderer.invoke('source:format',s,l,i),documentState:(d,s)=>ipcRenderer.send('document:state',d,s),
 loadDraft:(a,b,c,p=true)=>ipcRenderer.invoke('draft:load',a,b,c,p),projects:()=>ipcRenderer.invoke('projects'),
 createLab:n=>ipcRenderer.invoke('project:create',n),createProblem:(a,b,c)=>ipcRenderer.invoke('problem:create',a,b,c),
 saveConfig:(c,p)=>ipcRenderer.invoke('config:save',c,p),compilerInfo:c=>ipcRenderer.invoke('compiler:info',c),detectCompilers:()=>ipcRenderer.invoke('compiler:detect'),saveLayout:l=>ipcRenderer.invoke('layout:save',l),openSource:()=>ipcRenderer.invoke('source:open'),
 confirmUnsaved:()=>ipcRenderer.invoke('document:confirm'),validatePath:(p,k,e)=>ipcRenderer.invoke('path:validate',p,k,e),
 choosePath:(k,p)=>ipcRenderer.invoke('path:choose',k,p),revealPath:(p,k)=>ipcRenderer.invoke('path:reveal',p,k),
 importIO:(a,b)=>ipcRenderer.invoke('problem:import',a,b),importProject:()=>ipcRenderer.invoke('project:import'),exportProject:d=>ipcRenderer.invoke('project:export',d),exportSource:d=>ipcRenderer.invoke('source:export',d),showProblemFile:d=>ipcRenderer.invoke('problem:show',d),
 judge:d=>ipcRenderer.invoke('judge',d),cancel:()=>ipcRenderer.invoke('cancel'),debugStart:d=>ipcRenderer.invoke('debug:start',d),
 debugInput:d=>ipcRenderer.send('debug:input',d),debugResize:(c,r)=>ipcRenderer.send('debug:resize',c,r),debugStop:()=>ipcRenderer.invoke('debug:stop'),
 onJudge:c=>listen('judge:event',c),onDebugData:c=>listen('debug:data',c),onDebugState:c=>listen('debug:state',c)
};contextBridge.exposeInMainWorld('labpad',api);
