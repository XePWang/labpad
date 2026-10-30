import type {Comparison} from './types';
export function validateComparison(value:unknown,label='比较规则'):Comparison{
 const rule=value as Comparison;
 if(!rule||!['wcmp','floatTokens'].includes(rule.type))throw new Error(label+'：type 应为 wcmp 或 floatTokens');
 if(rule.type==='floatTokens'){
  const values=[rule.absoluteTolerance,rule.relativeTolerance];
  if(values.every(v=>v===undefined)||values.some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))throw new Error(label+'：至少设置一项有限且非负的 absoluteTolerance / relativeTolerance');
 }
 return rule;
}
