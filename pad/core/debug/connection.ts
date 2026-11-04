import {EventEmitter} from 'node:events';import type {Socket} from 'node:net';
export interface DapMessage{seq:number;type:'request'|'response'|'event';command?:string;event?:string;request_seq?:number;success?:boolean;message?:string;arguments?:any;body?:any}
export class DapConnection extends EventEmitter{
 private sequence=1;private buffer=Buffer.alloc(0);private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private closed=false;
 constructor(private socket:Socket,private reverse:(command:string,args:any)=>Promise<any>){
  super();socket.on('data',data=>this.read(data));socket.once('error',error=>this.close(error));socket.once('close',()=>this.close(Error('Debugger connection closed.')));
 }
 private send(message:DapMessage){if(this.closed)return;const body=JSON.stringify(message);this.socket.write('Content-Length: '+Buffer.byteLength(body)+'\r\n\r\n'+body);}
 request<T=any>(command:string,args:any={},timeout=20000):Promise<T>{
  if(this.closed)return Promise.reject(Error('Debugger connection is closed.'));
  const seq=this.sequence++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(seq);reject(Error('Debugger request timed out: '+command));},timeout);this.pending.set(seq,{resolve,reject,timer});this.send({seq,type:'request',command,arguments:args});});
 }
 private read(chunk:Buffer){
  this.buffer=Buffer.concat([this.buffer,chunk]);
  try{for(;;){
   const end=this.buffer.indexOf('\r\n\r\n');if(end<0){if(this.buffer.length>16384)throw Error('Invalid debugger message header.');return;}
   const match=/^Content-Length:\s*(\d+)$/im.exec(this.buffer.subarray(0,end).toString('ascii'));if(!match)throw Error('Debugger message has no content length.');
   const size=Number(match[1]);if(size>16*1024**2)throw Error('Debugger message exceeds the size limit.');
   if(this.buffer.length<end+4+size)return;
   const message=JSON.parse(this.buffer.subarray(end+4,end+4+size).toString('utf8')) as DapMessage;this.buffer=this.buffer.subarray(end+4+size);
   if(message.type==='response'){
    const item=this.pending.get(message.request_seq!);if(item){this.pending.delete(message.request_seq!);clearTimeout(item.timer);message.success?item.resolve(message.body):item.reject(Error(message.message||'Debugger request failed: '+message.command));}
   }else if(message.type==='request'){
    void this.reverse(message.command!,message.arguments).then(body=>this.send({seq:this.sequence++,type:'response',request_seq:message.seq,command:message.command,success:true,body}),error=>this.send({seq:this.sequence++,type:'response',request_seq:message.seq,command:message.command,success:false,message:error instanceof Error?error.message:String(error)}));
   }else if(message.type==='event')this.emit('event',message);
  }}catch(error){this.close(error instanceof Error?error:Error(String(error)));this.socket.destroy();}
 }
 close(error=Error('Debugger disconnected.')){
  if(this.closed)return;this.closed=true;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();this.buffer=Buffer.alloc(0);this.socket.destroy();this.emit('closed',error);
 }
}
