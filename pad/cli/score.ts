export interface ScoreItem{weight:number;passed:number;total:number}
interface Fraction{n:bigint;d:bigint}
function gcd(a:bigint,b:bigint):bigint{return b?gcd(b,a%b):a;}
function add(a:Fraction,b:Fraction):Fraction{const n=a.n*b.d+b.n*a.d,d=a.d*b.d,g=gcd(n,d);return {n:n/g,d:d/g};}
/** Round the exact total first, then distribute cents so displayed parts add up. */
export function score100(items:ScoreItem[]){
 const weights=items.reduce((n,x)=>n+x.weight,0);if(!weights)throw Error('至少需要一道计分题');
 const fractions=items.map(x=>{
  if(!Number.isSafeInteger(x.weight)||x.weight<0||x.weight>100000||x.weight&&(!Number.isSafeInteger(x.total)||x.total<=0)||x.passed<0||x.passed>x.total)throw Error('计分权重或测试点数量无效');
  return {n:BigInt(x.weight)*BigInt(x.passed)*10000n,d:BigInt(weights)*BigInt(x.total||1)};
 });
 const exact=fractions.reduce(add,{n:0n,d:1n}),rounded=Number((exact.n*2n+exact.d)/(2n*exact.d));
 const parts=fractions.map(x=>Number(x.n/x.d)),remaining=rounded-parts.reduce((a,b)=>a+b,0);
 const order=fractions.map((x,i)=>({i,n:x.n%x.d,d:x.d})).sort((a,b)=>{const left=a.n*b.d,right=b.n*a.d;return left===right?a.i-b.i:left>right?-1:1;});
 for(let i=0;i<remaining;i++)parts[order[i].i]++;
 return {parts:parts.map(x=>x/100),total:rounded/100,deduction:(10000-rounded)/100};
}
