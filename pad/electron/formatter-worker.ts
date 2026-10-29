import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const engine=import(pathToFileURL(workerData.moduleFile).href) as Promise<typeof import('@wasm-fmt/clang-format/node')>;
parentPort!.on('message',async({id,source,language,indentSize})=>{
 try{
  const {format}=await engine;
  const style=JSON.stringify({BasedOnStyle:'LLVM',IndentWidth:indentSize,TabWidth:indentSize,
   ContinuationIndentWidth:indentSize,UseTab:'Never',ColumnLimit:80,
   AllowShortFunctionsOnASingleLine:'None',AllowShortBlocksOnASingleLine:'Never',
   AllowShortIfStatementsOnASingleLine:'Never',SortIncludes:'Never',LineEnding:'LF'});
  parentPort!.postMessage({id,source:format(source,language==='cpp'?'main.cpp':'main.c',style)});
 }catch(error){parentPort!.postMessage({id,error:error instanceof Error?error.message:String(error)});}
});
