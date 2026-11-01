<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import {DialogRoot,DialogContent,DialogTitle} from 'reka-ui';
import ParameterPreview from './ParameterPreview.vue';
import {parameterErrors} from '../../shared/parameters';
import type {ProjectBuildOptions} from '../../shared/workspace';
import type {BuildPreview} from '../../core/build/plan';
const props=defineProps<{lab:string;options:ProjectBuildOptions;compilerLabel:string;preview:(options:ProjectBuildOptions)=>Promise<BuildPreview>;save:(options:ProjectBuildOptions)=>Promise<void>}>(),emit=defineEmits<{close:[]}>();
const inherit=ref(props.options.inheritDefaults),c=ref(props.options.cArgs.join('\n')),cpp=ref(props.options.cppArgs.join('\n')),link=ref(props.options.linkArgs.join('\n')),error=ref(''),saving=ref(false),loading=ref(false),value=ref<BuildPreview>();
const lines=(s:string)=>s.split(/\r?\n/).filter(Boolean),options=()=>({inheritDefaults:inherit.value,cArgs:lines(c.value),cppArgs:lines(cpp.value),linkArgs:lines(link.value)});
let timer:ReturnType<typeof setTimeout>|undefined,request=0;
function validate(){if(inherit.value)return;for(const [field,args]of [['C 参数',lines(c.value)],['C++ 参数',lines(cpp.value)],['链接参数',lines(link.value)]] as const){const issue=parameterErrors(args,field)[0];if(issue)throw Error(field+'：'+issue.message);}}
async function refresh(){const id=++request;loading.value=true;try{validate();const v=await props.preview(options());if(id===request){value.value=v;error.value='';}}catch(e){if(id===request){value.value=undefined;error.value=e instanceof Error?e.message:String(e);}}finally{if(id===request)loading.value=false;}}
watch(()=>JSON.stringify([inherit.value,c.value,cpp.value,link.value]),()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),180);},{immediate:true});
onBeforeUnmount(()=>{clearTimeout(timer);request++;});
async function save(){if(saving.value)return;saving.value=true;try{validate();const value=options();await props.save(value);emit('close');}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{saving.value=false;}}
</script>
<template><DialogRoot :open="true" @update:open="!$event&&!saving&&emit('close')"><div class="modal-backdrop"><DialogContent as-child @close-auto-focus.prevent @interact-outside.prevent @escape-key-down="saving&&$event.preventDefault()"><section class="build-settings" role="dialog" aria-modal="true" aria-label="题集构建设置"><DialogTitle as-child><h2>构建设置 · {{lab}}</h2></DialogTitle><p>{{compilerLabel}} · 本题集的各题使用同一组参数。</p><fieldset class="build-inputs" :disabled="saving"><label class="checkbox-field"><input v-model="inherit" type="checkbox">跟随本机默认参数</label><p v-if="error" class="field-error" role="alert">{{error}}</p><div class="build-settings-fields"><div v-if="!inherit" class="field-grid two"><label>C 参数<textarea v-model="c" rows="5" spellcheck="false"></textarea></label><label>C++ 参数<textarea v-model="cpp" rows="5" spellcheck="false"></textarea></label><label>链接参数<textarea v-model="link" rows="5" spellcheck="false"></textarea></label><p>自定义参数替换本机参数；每行一个参数。未指定标准时使用 C17 / C++20。</p></div><ParameterPreview :value="value" :loading="loading"/></div></fieldset><div class="create-actions"><button :disabled="saving" @click="emit('close')">取消</button><button class="primary" :disabled="saving" @click="save">{{saving?'保存中…':'保存构建设置'}}</button></div></section></DialogContent></div></DialogRoot></template>
