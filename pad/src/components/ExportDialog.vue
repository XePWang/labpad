<script setup lang="ts">
import {computed,onMounted,ref} from 'vue';
import {DialogRoot,DialogPortal,DialogOverlay,DialogContent,DialogTitle,DialogDescription} from 'reka-ui';
import type {Draft,ExportProblem,ExportPreview} from '../../shared/types';
const props=defineProps<{kind:'source'|'project';current:Draft;buffers:Draft[];theme:string;studentId:string;suspended:boolean}>();
const emit=defineEmits<{(e:'close'):void;(e:'settings'):void;(e:'done',path:string):void}>();
const groups=ref<ExportProblem[]>([]),selected=ref<string[]>([]),step=ref<'select'|'warning'>('select'),preview=ref<ExportPreview>(),loading=ref(true),error=ref('');
const drafts=computed(()=>props.kind==='source'?[props.current]:groups.value.flatMap(g=>g.versions.filter(v=>selected.value.includes(v.documentId!))));
const topics=computed(()=>new Set(drafts.value.map(d=>d.problem.problemId)).size);
const missingIdentity=computed(()=>preview.value?.warnings.some(w=>w.startsWith('未填写身份信息')));
function checked(group:ExportProblem){const count=group.versions.filter(v=>selected.value.includes(v.documentId!)).length;return count===group.versions.length&&count>0;}
function mixed(group:ExportProblem){return !checked(group)&&group.versions.some(v=>selected.value.includes(v.documentId!));}
function selectGroup(group:ExportProblem,event:Event){const ids=group.versions.map(v=>v.documentId!);selected.value=selected.value.filter(id=>!ids.includes(id));if((event.target as HTMLInputElement).checked)selected.value.push(...ids);}
function filename(id:string){
 const counts=new Map<string,number>();
 for(const d of drafts.value){const key=d.problem.problemId,n=(counts.get(key)??0)+1;counts.set(key,n);if(d.documentId===id)return (props.studentId.trim()?props.studentId.trim()+'_':'')+key+(n>1?'_v'+n:'')+(d.language==='cpp'?'.cpp':'.c');}
 return '未选择';
}
async function write(){
 if(!preview.value)return;loading.value=true;error.value='';
 try{const file=await window.labpad.writeExport(JSON.parse(JSON.stringify(preview.value)));if(file)emit('done',file);else loading.value=false;}
 catch(e){error.value=e instanceof Error?e.message:String(e);loading.value=false;}
}
async function next(){
 if(!drafts.value.length)return;loading.value=true;error.value='';
 try{
  preview.value=await window.labpad.exportPreview(props.kind,JSON.parse(JSON.stringify(drafts.value)));
  if(preview.value.warnings.length){step.value='warning';loading.value=false;}else await write();
 }catch(e){error.value=e instanceof Error?e.message:String(e);loading.value=false;}
}
function all(on:boolean){selected.value=on?groups.value.flatMap(g=>g.versions.map(v=>v.documentId!)):[];}
onMounted(async()=>{
 try{
  if(props.kind==='project'){groups.value=await window.labpad.exportChoices(JSON.parse(JSON.stringify(props.buffers)));all(true);loading.value=false;}
  else await next();
 }catch(e){error.value=e instanceof Error?e.message:String(e);loading.value=false;}
});
defineExpose({resumeSettings:next,cancelSettings:()=>{step.value='warning';}});
</script>
<template>
 <DialogRoot :open="!suspended" @update:open="!$event&&!loading&&emit('close')"><DialogPortal><DialogOverlay class="export-overlay"/>
  <DialogContent class="export-dialog" :data-theme="theme" @escape-key-down="loading&&$event.preventDefault()" @interact-outside="$event.preventDefault()">
   <DialogTitle>{{kind==='project'?'导出实验项目':'导出源码'}}</DialogTitle>
   <DialogDescription>{{step==='select'?'勾选本次提交的题号和源码版本。':'确认这些提醒后，选择保存位置。'}}</DialogDescription>
   <p v-if="error" class="field-error" role="alert">{{error}}</p><p v-if="loading" role="status">正在准备导出…</p>
   <template v-if="step==='select'&&kind==='project'">
    <div class="export-summary"><span>{{topics}} 题 · {{drafts.length}} 份源码</span><div><button :disabled="loading" @click="all(true)">全选</button><button :disabled="loading" @click="all(false)">取消全选</button></div></div>
    <div class="export-list"><details v-for="group in groups" :key="group.problemId" open>
     <summary><input type="checkbox" :aria-label="'导出题号 '+group.problemId" :checked="checked(group)||mixed(group)" :indeterminate.prop="mixed(group)" :disabled="loading||!group.versions.length" @click.stop @change="selectGroup(group,$event)"><strong>{{group.problemId}}</strong><small>{{group.versions.length?group.versions.filter(v=>selected.includes(v.documentId!)).length+' / '+group.versions.length+' 份':'暂无源码'}}</small></summary>
     <label v-for="v in group.versions" :key="v.documentId" class="export-version"><input v-model="selected" :value="v.documentId" type="checkbox" :aria-label="'导出版本 '+group.problemId+' '+v.name" :disabled="loading"><span><span>{{v.name}} <small>{{v.language==='cpp'?'C++':'C'}} · {{new Date(v.modifiedAt).toLocaleString('zh-CN',{hour12:false})}}</small></span><code v-if="selected.includes(v.documentId!)">导出为 {{filename(v.documentId!)}}</code></span></label>
    </details></div>
   </template>
   <template v-else-if="preview"><ul class="export-warnings"><li v-for="warning in preview.warnings" :key="warning">{{warning}}</li></ul><p>{{preview.files.length}} 份源码 · {{preview.name}}</p><button v-if="missingIdentity" :disabled="loading" @click="emit('settings')">前往设置</button></template>
   <div class="export-actions"><button :disabled="loading" @click="emit('close')">取消导出</button><button v-if="step==='warning'&&kind==='project'" :disabled="loading" @click="step='select'">返回选择</button><button v-if="step==='select'" class="primary" :disabled="loading||!drafts.length" @click="next">下一步</button><button v-else class="primary" :disabled="loading||!preview" @click="write">仍然导出</button></div>
  </DialogContent>
 </DialogPortal></DialogRoot>
</template>
<style>
.export-overlay{position:fixed;inset:0;background:#0008;z-index:80}.export-dialog{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);z-index:81;width:min(680px,92vw);max-height:85vh;display:flex;flex-direction:column;gap:14px;padding:24px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:9px;box-shadow:0 20px 70px #0008}
.export-dialog h2{font-size:20px}.export-dialog p{font-size:12px;line-height:1.6;color:var(--secondary)}.export-list{overflow:auto;min-height:0}.export-list details{border-top:1px solid var(--border);padding:8px 0}.export-list summary{display:flex;gap:10px;align-items:center;cursor:pointer;padding:6px 2px;list-style:revert}.export-list summary small{margin-left:auto}.export-dialog input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent);margin:0;flex-shrink:0}.export-version{display:flex;flex-direction:row;align-items:center;gap:10px;padding:10px 8px 10px 25px;font-size:12px}.export-version>span{display:flex;flex-direction:column;gap:5px;min-width:0}.export-version small,.export-list summary small{color:var(--muted);font-size:11px}.export-version code{color:var(--secondary);font-size:11px;overflow-wrap:anywhere}.export-summary{display:flex;justify-content:space-between;align-items:center;font-size:12px}.export-summary button{margin-left:6px;font-size:11px}.export-warnings{overflow:auto;padding-left:20px;font-size:12px;line-height:1.8;white-space:pre-wrap}.export-warnings li+li{margin-top:10px}.export-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}.export-dialog button{padding:7px 12px;border-radius:5px;background:var(--raised);color:var(--text);border:1px solid var(--border)}.export-dialog button.primary{background:var(--accent);color:white;border-color:var(--accent)}
.export-list summary::before{content:'›';display:inline-block;width:10px;font-size:18px;line-height:1;color:var(--muted);transform:rotate(90deg)}.export-list details:not([open]) summary::before{transform:none}
</style>
