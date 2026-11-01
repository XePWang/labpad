import {compileDraft} from './build';
import type {Compiler} from './compiler';
import type {Draft,CompilerConfig,Compilation} from '../shared/types';
export type PreparedProgram=Awaited<ReturnType<typeof compileDraft>>;
export class CompiledProgram {
 private current?:{key:string;program:PreparedProgram};
 constructor(private compiler:Compiler){}
 matches(key:string){return this.current?.key===key;}
 require(key:string):PreparedProgram{if(!this.current||this.current.key!==key)throw new Error('请先保存源码与构建配置，再点击“编译”。');return this.current.program;}
 async clear(){const previous=this.current;this.current=undefined;await previous?.program.cleanup();}
 async compile(key:string,draft:Draft,options:CompilerConfig,signal?:AbortSignal):Promise<Compilation>{
  await this.clear();let prepared:PreparedProgram|undefined;
  try{prepared=await compileDraft(this.compiler,draft,options,signal);
   if(prepared.compilation.status==='success'&&!signal?.aborted){this.current={key,program:prepared};return prepared.compilation;}
   const result=prepared.compilation;await prepared.cleanup();prepared=undefined;return result;
  }catch(error){await prepared?.cleanup();throw error;}
 }
}
