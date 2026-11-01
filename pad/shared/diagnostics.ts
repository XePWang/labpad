export interface DiagnosticCounts{warnings:number;errors:number}
export function diagnosticCounts(stdout:string,stderr=''):DiagnosticCounts{
 const counts={warnings:0,errors:0};
 for(const line of (stdout+'\n'+stderr).split(/\r?\n/)){
  const match=line.match(/^(?:(?:.*?:\d+(?::\d+)?|.+\(\d+(?:,\d+)?\)|[^\s:"()]+):\s*)?(fatal error|error|warning|错误|警告)(?:\s+[A-Z]\d+)?\s*[:：]/i);
  if(!match||/^\s*(?:\d+\s*\||\||\^)/.test(line))continue;
  if(/warning|警告/i.test(match[1]))counts.warnings++;else counts.errors++;
 }
 return counts;
}
