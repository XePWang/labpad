export type Language='c'|'cpp';
export type Verdict='AC'|'WA'|'CE'|'RE'|'TLE'|'OLE';
export type Comparison={type:'wcmp'}|{type:'floatTokens';absoluteTolerance?:number;relativeTolerance?:number};
export interface TestCase{id:string;input:string;expectedOutput:string}
export interface Problem{schemaVersion:1;labId:string;problemId:string;title:string;timeLimitMs:number;outputLimitBytes:number;comparison:Comparison;testCases:TestCase[]}
export interface CompilerConfig{mode:'builtin'|'custom';kind:'zig'|'gcc'|'clang';cPath:string;cppPath:string;cArgs:string[];cppArgs:string[];linkArgs:string[]}
export interface DetectedCompiler{id:string;name:string;version:string;target:string;compiler:CompilerConfig}
export interface LayoutConfig{editorPercent:number;outputPercent:number}
export interface EditorCursor{line:number;column:number;selectionChars:number;selectionLines:number;lines:number;focused:boolean}
export interface Config{schemaVersion:1;classId:string;name:string;studentId:string;currentLab:string;currentProblem:string;language:Language;compiler:CompilerConfig;debugTimeLimitMs:number|null;terminalBufferLines:number;saveMode:'manual'|'auto';sourceFile:string|null;indentSize:1|2|4;theme:'light'|'dark';formatOnSave:boolean;layout:LayoutConfig}
export interface Draft{source:string;language:Language;problem:Problem}
export interface LoadedDraft extends Draft{sourceFile?:string;sourceEncoding?:string;warning?:string}
export interface Project{labId:string;problems:string[]}
export interface ProcessResult{code:number|null;signal:string|null;stdout:Buffer;stderr:Buffer;elapsedMs:number;reason?:'timeout'|'output'|'cancelled';stderrTruncated:boolean}
export interface Compilation{status:'success'|'CE'|'cancelled';stdout:string;stderr:string;command:string[];elapsedMs:number}
export interface CaseResult{id:string;verdict?:Exclude<Verdict,'CE'>;status:'completed'|'cancelled'|'error';elapsedMs:number;stdout:string;stderr:string;exitCode:number|null;signal:string|null;message:string}
export interface JudgeResult{status:'completed'|'cancelled'|'error';compilation?:Compilation;cases:CaseResult[];error?:string;compiler:string;comparison:Comparison}
export type JudgeEvent={type:'compilation';compilation:Compilation}|{type:'case';index:number;result:CaseResult};
export interface SaveResult{path:string;source:string;formatWarning?:string}
export interface SettingsResult{config:Config;dataRoot:string;compilerLabel:string;projects:Project[]}
export interface Bootstrap extends SettingsResult{draft:LoadedDraft;sourcePath:string|null;version:string;warning?:string}
export interface DebugState{status:'compiling'|'running'|'exited'|'stopped'|'error';message?:string}
export type PathKind='directory'|'executable';
export interface Bridge{
 bootstrap():Promise<Bootstrap>;reloadDocument():Promise<Bootstrap>;saveDraft(draft:Draft):Promise<SaveResult>;formatCode(source:string,language:Language,indentSize:number):Promise<string>;documentState(draft:Draft,dirty:boolean):void;
 loadDraft(labId:string,problemId:string,language:Language,preferStored?:boolean):Promise<LoadedDraft>;
 projects():Promise<Project[]>;createLab(name:string):Promise<Draft>;createProblem(lab:string,name:string,language:Language):Promise<Draft>;
 saveConfig(config:Config,dataRoot:string):Promise<SettingsResult>;compilerInfo(config:CompilerConfig):Promise<string>;detectCompilers():Promise<DetectedCompiler[]>;saveLayout(layout:LayoutConfig):Promise<LayoutConfig>;
 openSource():Promise<{source:string;language:Language;encoding:string;path:string}|null>;
 confirmUnsaved():Promise<'save'|'discard'|'cancel'>;
 validatePath(value:string,kind:PathKind,allowEmpty?:boolean):Promise<{valid:boolean;message:string}>;
 choosePath(kind:PathKind,current:string):Promise<string|null>;revealPath(value:string,kind:PathKind):Promise<void>;
 importIO(labId:string,problemId:string):Promise<Problem|null>;importProject():Promise<Bootstrap|null>;exportProject(draft:Draft):Promise<string|null>;exportSource(draft:Draft):Promise<string|null>;showProblemFile(draft:Draft):Promise<void>;
 judge(draft:Draft):Promise<JudgeResult>;cancel():Promise<void>;debugStart(draft:Draft):Promise<void>;debugInput(data:string):void;debugResize(cols:number,rows:number):void;debugStop():Promise<void>;
 onJudge(callback:(event:JudgeEvent)=>void):()=>void;onDebugData(callback:(data:string)=>void):()=>void;onDebugState(callback:(state:DebugState)=>void):()=>void;
}
