import {Worker} from 'node:worker_threads';
import type {Language} from '../shared/types';
export class Formatter{
 private worker?:Worker;private nextId=0;
 private pending=new Map<number,{resolve:(text:string)=>void;reject:(error:Error)=>void}>();
 constructor(readonly workerFile:string,readonly moduleFile:string){}
 private start(){
  const worker=new Worker(this.workerFile,{workerData:{moduleFile:this.moduleFile}});
  worker.on('message',(message:{id:number;source?:string;error?:string})=>{
   const task=this.pending.get(message.id);if(!task)return;this.pending.delete(message.id);
   if(message.error)task.reject(new Error(message.error));else task.resolve(message.source!);
  });
  const failed=(error:Error)=>{if(this.worker!==worker)return;for(const task of this.pending.values())task.reject(error);this.pending.clear();if(this.worker===worker)this.worker=undefined;};
  worker.on('error',failed);worker.on('exit',()=>failed(new Error('格式化线程已结束')));
  this.worker=worker;return worker;
 }
 format(source:string,language:Language,indentSize:number):Promise<string>{
  if(![1,2,4].includes(indentSize))return Promise.reject(new Error('缩进宽度应为 1、2 或 4'));
  const worker=this.worker??this.start(),id=++this.nextId;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});worker.postMessage({id,source,language,indentSize});});
 }
 async dispose(){const worker=this.worker;this.worker=undefined;for(const task of this.pending.values())task.reject(new Error("格式化任务已结束"));this.pending.clear();await worker?.terminate();}
}
