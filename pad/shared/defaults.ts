import type {Config,Problem,Language,CompilerConfig} from './types';
export function defaultCompilerConfig(kind:CompilerConfig['kind'],msvc=false):CompilerConfig{
 return {mode:'builtin',kind,cPath:'',cppPath:'',cArgs:['-std=c17','-O2','-Wall','-Wextra'],cppArgs:['-std=c++17','-O2','-Wall','-Wextra'],linkArgs:msvc?[]:['-lm']};
}
export function defaultConfig():Config{
 return {schemaVersion:1,classId:'',name:'',studentId:'',currentLab:'',currentProblem:'',language:'c',
 compiler:defaultCompilerConfig('zig'),
 debugTimeLimitMs:null,terminalBufferLines:3000,saveMode:'manual',sourceFile:null,indentSize:4,theme:'dark',formatOnSave:true,layout:{editorPercent:53,outputPercent:28}};
}
export function defaultProblem(labId:string,problemId:string):Problem{
 return {schemaVersion:1,labId,problemId,title:'',timeLimitMs:1000,outputLimitBytes:65536,comparison:{type:'wcmp'},testCases:[]};
}
export function defaultSource(language:Language):string{
 return language==='c'?'#include <stdio.h>\n\nint main(void) {\n    // 在这里编写代码\n    return 0;\n}\n':
 '#include <iostream>\n\nint main() {\n    // 在这里编写代码\n    return 0;\n}\n';
}
