<script setup lang="ts">
import {PopoverRoot,PopoverTrigger,PopoverPortal,PopoverContent,PopoverClose} from 'reka-ui';
defineProps<{theme:string}>();
const definitions=[['AC · 通过','程序正常结束，输出符合本测试点的比较规则。'],['WA · 答案不符','输出与预期不同，可以打开 Diff 查看差异。'],['CE · 编译失败','未能生成可执行程序，请到“输出”页查看编译信息。'],['TLE · 运行超时','程序运行超过本题的时间限制。'],['RE · 运行异常','程序异常结束，或返回了非零退出码。'],['OLE · 输出过多','程序输出超过本题的字节限制。']];
</script>
<template><PopoverRoot><PopoverTrigger class="result-help" aria-label="结果说明">?</PopoverTrigger><PopoverPortal><PopoverContent class="result-help-content" :data-theme="theme" :collision-padding="12" :side-offset="6" aria-label="评测结果说明"><div class="help-heading"><strong>结果说明</strong><PopoverClose aria-label="关闭结果说明">×</PopoverClose></div><dl><template v-for="[title,body] in definitions" :key="title"><dt>{{title}}</dt><dd>{{body}}</dd></template></dl></PopoverContent></PopoverPortal></PopoverRoot></template>
<style>
.result-help{font-size:11px!important;min-width:22px;min-height:22px;border-radius:50%!important;padding:1px 5px!important}
.result-help-content{z-index:70;max-width:min(360px,90vw);padding:16px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 30px #0005;font-size:12px;line-height:1.6}.help-heading{display:flex;justify-content:space-between;align-items:center}.result-help-content dt{font-weight:600;margin-top:10px}.result-help-content dd{margin:2px 0 0;color:var(--secondary)}
</style>
