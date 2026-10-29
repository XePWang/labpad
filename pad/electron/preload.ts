import {contextBridge,ipcRenderer} from 'electron';
import type {Bridge} from '../shared/types';
function listen(channel:string,callback:(value:any)=>void){
 const handler=(_event:unknown,value:unknown)=>callback(value);ipcRenderer.on(channel,handler);
 return ()=>ipcRenderer.removeListener(channel,handler);
}
const api:Bridge={
 bootstrap:()=>ipcRenderer.invoke('bootstrap'),saveDraft:d=>ipcRenderer.invoke('draft:save',d),
 loadDraft:(a,b,c)=>ipcRenderer.invoke('draft:load',a,b,c),saveConfig:c=>ipcRenderer.invoke('config:save',c),
 compilerInfo:c=>ipcRenderer.invoke('compiler:info',c),openSource:()=>ipcRenderer.invoke('source:open'),
 importIO:(a,b)=>ipcRenderer.invoke('problem:import',a,b),exportSource:d=>ipcRenderer.invoke('source:export',d),
 showProblemFile:d=>ipcRenderer.invoke('problem:show',d),judge:d=>ipcRenderer.invoke('judge',d),
 cancel:()=>ipcRenderer.invoke('cancel'),debugStart:d=>ipcRenderer.invoke('debug:start',d),
 debugInput:d=>ipcRenderer.send('debug:input',d),debugResize:(c,r)=>ipcRenderer.send('debug:resize',c,r),
 debugStop:()=>ipcRenderer.invoke('debug:stop'),onJudge:c=>listen('judge:event',c),
 onDebugData:c=>listen('debug:data',c),onDebugState:c=>listen('debug:state',c)
};
contextBridge.exposeInMainWorld('labpad',api);
