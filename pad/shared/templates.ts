import type {Language} from './types';
export type SourceTemplates=Partial<Record<Language,string>>;
export function sourceText(value:unknown,label:string):string{
 if(Array.isArray(value)){if(!value.every(s=>typeof s==='string'&&!/[\r\n]/.test(s)))throw new Error(label+'数组每项应为一行源码');return value.join('\n')+'\n';}
 if(typeof value!=='string')throw new Error(label+'应为字符串或逐行字符串数组');return value;
}
export function parseTemplates(value:unknown):SourceTemplates|undefined{
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['c','cpp'].includes(k)))throw new Error('templates应只包含c、cpp模板');
 const templates:SourceTemplates={};for(const key of ['c','cpp'] as const)if(Object.hasOwn(value,key))templates[key]=sourceText((value as Record<string,unknown>)[key],'templates.'+key+' ');return templates;
}
