import type {Comparison} from './types';
export function validateComparison(value:unknown,label='比较规则'):Comparison{
 const rule=value as Comparison;
 if(!rule||!['wcmp','floatTokens','strictText'].includes(rule.type))throw new Error(label+'：type 应为 wcmp、floatTokens 或 strictText');
 if(rule.type==='floatTokens'){
  const values=[rule.absoluteTolerance,rule.relativeTolerance];
  if(values.every(v=>v===undefined)||values.some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))throw new Error(label+'：至少设置一项有限且非负的 absoluteTolerance / relativeTolerance');
 }
 if(rule.type==='strictText')for(const key of ['ignoreTrailingSpaces','ignoreFinalNewlines'] as const){
  if(rule[key]!==undefined&&typeof rule[key]!=='boolean')throw new Error(label+'：'+key+' 应为布尔值');
 }
 return rule;
}
export function strictText(actual:string,expected:string,rule:Extract<Comparison,{type:'strictText'}>){
 const normalize=(text:string)=>{
  text=text.replace(/\r\n/g,'\n');
  if(rule.ignoreTrailingSpaces)text=text.replace(/[ \t]+(?=\n|$)/g,'');
  if(rule.ignoreFinalNewlines)text=text.replace(/\n+$/,'');
  return text;
 };
 const a=normalize(actual),e=normalize(expected);
 if(a===e)return {accepted:true,message:'输出符合严格文本规则'};
 let offset=0;while(offset<Math.min(a.length,e.length)&&a[offset]===e[offset])offset++;
 const before=e.slice(0,offset).split('\n'),line=before.length,column=before.at(-1)!.length+1;
 const show=(char:string|undefined)=>char===undefined?'文件结束':char===' '?'空格':char==='\t'?'Tab':char==='\n'?'换行':char==='\r'?'回车':JSON.stringify(char);
 return {accepted:false,message:'第 '+line+' 行、第 '+column+' 列不同：预期 '+show(e[offset])+'，实际 '+show(a[offset])};
}
