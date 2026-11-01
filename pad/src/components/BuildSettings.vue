<script setup lang="ts">
import {ref,computed} from 'vue';import {parse,editSingle,editList,type Command} from '../../shared/lpmake';
const props=defineProps<{source:string;revision:number}>(),emit=defineEmits<{apply:[text:string,revision:number];close:[]}>();
const error=ref(''),original=props.source,version=props.revision;
let initial:ReturnType<typeof parse>|undefined;try{initial=parse(original);}catch(e){error.value=String(e);}
const target=ref(initial?.spec.target??''),language=ref(initial?.spec.language==='cpp'?'c++':initial?.spec.language??''),cStandard=ref(initial?.spec.standards.c??''),cppStandard=ref(initial?.spec.standards.cpp??''),mode=ref(initial?.calls.some(c=>c.name==='set_mode')?initial.spec.mode:''),optimize=ref(initial?.spec.optimize??'');
const lists:{command:Command;label:string;value:string}[]=initial?[
 ['add_files','源文件 / Glob',initial.spec.sources],['remove_files','排除文件',initial.spec.exclude],['add_includedirs','包含目录',initial.spec.includeDirs],['add_defines','宏定义',initial.spec.defines],['add_linkdirs','库目录',initial.spec.linkDirs],['add_links','链接库',initial.spec.links],['add_cflags','C 参数',initial.spec.cflags],['add_cxxflags','C++ 参数',initial.spec.cxxflags],['add_ldflags','链接参数',initial.spec.ldflags]
].map(([command,label,values])=>({command:command as Command,label:label as string,value:(values as string[]).join('\n')})):[];
const fields=ref(lists),valid=computed(()=>!!initial);
function apply(){
 try{
  let text=editSingle(original,'target',target.value);
  text=editSingle(text,'set_language',language.value||undefined);text=editSingle(text,'set_standard',cStandard.value||undefined,'c');text=editSingle(text,'set_standard',cppStandard.value||undefined,'cpp');
  text=editSingle(text,'set_mode',mode.value||undefined);text=editSingle(text,'set_optimize',optimize.value||undefined);
  for(const field of fields.value)text=editList(text,field.command,field.value.split(/\r?\n/).filter(Boolean));
  parse(text);emit('apply',text,version);
 }catch(e){error.value=e instanceof Error?e.message:String(e);}
}
</script>
<template><div class="modal-backdrop" @keydown.esc.stop.prevent="emit('close')"><section class="build-settings" role="dialog" aria-modal="true" aria-label="项目构建设置"><h2>项目构建设置</h2><p>修改写入同一个 LPMake 编辑缓冲；保存后落盘。每行一个路径或参数。</p><p v-if="error" class="field-error" :class="{'source-diagnostic':error.startsWith('LPMake.txt:')}" role="alert">{{error}}</p><div v-if="valid" class="build-settings-fields"><div class="field-grid two"><label>目标名称<input v-model="target"></label><label>编译语言<select v-model="language"><option value="">按文件扩展名</option><option value="c">C（覆盖扩展名）</option><option value="c++">C++（覆盖扩展名）</option></select></label><label>C 标准<input v-model="cStandard" placeholder="默认 / c11 / c17"></label><label>C++ 标准<input v-model="cppStandard" placeholder="默认 / c++20"></label><label>构建模式<select v-model="mode"><option value="">默认 · debug</option><option value="debug">debug</option><option value="release">release</option></select></label><label>优化<select v-model="optimize"><option value="">跟随模式</option><option v-for="v in ['O0','O1','O2','O3','Os']" :value="v">{{v}}</option></select></label></div><div class="field-grid two"><label v-for="field in fields" :key="field.command">{{field.label}}<textarea v-model="field.value" rows="3" spellcheck="false"></textarea></label></div></div><div class="create-actions"><button @click="emit('close')">取消</button><button v-if="valid" class="primary" @click="apply">应用到 LPMake</button></div></section></div></template>
<style>.build-settings{display:flex;flex-direction:column;gap:12px;max-height:86vh;width:min(760px,92vw);background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:24px}.build-settings-fields{overflow:auto;min-height:0;padding:2px}.build-settings-fields>.field-grid+.field-grid{margin-top:16px}.build-settings p{font-size:12px;color:var(--muted);line-height:1.6}</style>
