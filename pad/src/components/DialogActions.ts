import {defineComponent,h,Fragment,type VNode} from 'vue';
import {windowsActions} from '../../shared/dialog-actions';
function flatten(nodes:VNode[]):VNode[]{return nodes.flatMap(node=>node.type===Fragment&&Array.isArray(node.children)?flatten(node.children as VNode[]):[node]);}
export default defineComponent({inheritAttrs:false,setup(_,context){return()=>{const nodes=flatten(context.slots.default?.()??[]);return h('div',{...context.attrs,class:['dialog-actions',context.attrs.class]},windowsActions(navigator.platform)?nodes.reverse():nodes);};}});
