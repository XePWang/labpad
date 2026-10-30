import {readFile} from 'node:fs/promises';
import {parse} from 'csv-parse/sync';
import {decodeText} from '../core/storage';
import * as XLSX from 'xlsx';
export interface Student{sequence:string;studentId:string;name:string}
export async function readRoster(file:string):Promise<Student[]>{
 const bytes=await readFile(file),book=/\.csv$/i.test(file)?undefined:XLSX.read(bytes,{type:'buffer',raw:true});
 const rows:unknown[][]=book?XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:false}):parse(decodeText(bytes).text,{bom:true,skip_empty_lines:true});
 const clean=(v:unknown)=>String(v??'').replace(/^\uFEFF/,'').trim();
 const aliases={studentId:['学号','studentId','student_id'],name:['姓名','name'],sequence:['序号','sequence','seq']};
 let columns:Record<string,number>|undefined,start=0;
 for(const [index,row] of rows.entries()){
  const found=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,row.findIndex(v=>names.includes(clean(v)))]));
  if(found.studentId>=0&&found.name>=0){columns=found;start=index+1;break;}
 }
 if(!columns)throw new Error('点名册中未找到“学号”和“姓名”表头');
 const result:Student[]=[],seen=new Set<string>();
 for(const row of rows.slice(start)){
  const studentId=clean(row[columns.studentId]),name=clean(row[columns.name]);if(!studentId&&!name)continue;
  if(!/^\d+$/.test(studentId)||!name)throw new Error('点名册记录不完整：'+(studentId||name));
  if(seen.has(studentId))throw new Error('点名册学号重复：'+studentId);seen.add(studentId);
  result.push({studentId,name,sequence:columns.sequence>=0?clean(row[columns.sequence]):String(result.length+1)});
 }
 if(!result.length)throw new Error('点名册没有学生记录');return result;
}
