<script setup lang="ts">
import {ref,watch,onBeforeUnmount,nextTick} from 'vue';
import type {PathKind} from '../../shared/types';
const props=defineProps<{modelValue:string;label:string;kind:PathKind;allowEmpty?:boolean}>();
const emit=defineEmits<{(e:'update:modelValue',value:string):void;(e:'valid',value:boolean):void}>();
const field=ref<HTMLDivElement>(),error=ref(''),checking=ref(false);let revision=0,timer:ReturnType<typeof setTimeout>;
async function check(value:string,id:number){
 checking.value=true;
 try{const result=await window.labpad.validatePath(value,props.kind,props.allowEmpty);
  if(id===revision){error.value=result.message;emit('valid',result.valid);
   if(!result.valid){await nextTick();if(field.value?.contains(document.activeElement))field.value.scrollIntoView({block:'nearest'});}
  }
 }catch(e){if(id===revision){error.value=String(e);emit('valid',false);}}
 finally{if(id===revision)checking.value=false;}
}
watch(()=>[props.modelValue,props.allowEmpty],()=>{const id=++revision;clearTimeout(timer);emit('valid',false);timer=setTimeout(()=>check(props.modelValue,id),200);},{immediate:true});
async function browse(){const value=await window.labpad.choosePath(props.kind,props.modelValue);if(value!==null)emit('update:modelValue',value);}
async function reveal(){try{await window.labpad.revealPath(props.modelValue,props.kind);}catch(e){error.value=e instanceof Error?e.message:String(e);}}
onBeforeUnmount(()=>{revision++;clearTimeout(timer);});
</script>
<template>
 <div ref="field" class="path-field"><label>{{label}}<span class="path-input"><input :value="modelValue" :aria-label="label" :aria-invalid="!!error" @input="emit('update:modelValue',($event.target as HTMLInputElement).value)" spellcheck="false"><button type="button" :aria-label="'选择'+label" @click="browse">浏览…</button><button type="button" :aria-label="'定位'+label" :disabled="!modelValue||!!error||checking" @click="reveal">定位</button></span></label><p v-if="error" class="field-error" role="alert">{{error}}</p></div>
</template>
