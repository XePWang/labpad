export const shortcutActions=[
 ['run','编译并运行',['F9','Control+Enter']],['save','保存当前',['$mod+KeyS']],['saveAll','保存全部',['$mod+Shift+KeyS']],
 ['format','格式化代码',['Shift+Alt+KeyF']],['close','关闭标签',['Control+F4']],['closeSaved','关闭已保存',['$mod+KeyK KeyU']],
 ['closeAll','关闭全部标签',['$mod+KeyK KeyW']],['next','下一个标签',['Control+Tab']],['previous','上一个标签',['Control+Shift+Tab']],
 ['copyPath','复制路径',['Shift+Alt+KeyC']],['copyRelativePath','复制相对路径',['Control+Shift+Alt+KeyC']],['interrupt','中断调试',['Control+KeyC']]
] as const;
export const defaultShortcuts=():Record<string,string[]>=>Object.fromEntries(shortcutActions.map(([id,,keys])=>[id,[...keys]]));
export function validateShortcuts(value:unknown):Record<string,string[]>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('快捷键设置无效');
 const map=value as Record<string,string[]>,used:string[]=[];
 for(const [id] of shortcutActions){
  const keys=map[id];if(!Array.isArray(keys)||keys.length>3||keys.some(k=>typeof k!=='string'||!k.trim()))throw new Error('快捷键设置无效：'+id);
  for(const key of keys){
   const parts=key.trim().split(' ');
   if(parts.length>2||parts.some(p=>!/^((\$mod|Control|Alt|Shift|Meta)\+)*([A-Za-z][A-Za-z0-9]*|[0-9])$/.test(p)))throw new Error('快捷键格式无效：'+key);
   const canonical=parts.map(p=>{const bits=p.toLowerCase().replace(/\$mod/g,'control').split('+'),last=bits.pop();return bits.sort().join('+')+'+'+last;}).join(' ');
   if(used.some(k=>k===canonical||k.startsWith(canonical+' ')||canonical.startsWith(k+' ')))throw new Error('快捷键重复或前缀冲突：'+key);
   if(/^(alt\+f4|control\+alt\+delete|meta\+keyq)$/.test(canonical))throw new Error('该组合键由系统使用：'+key);used.push(canonical);
  }
 }
 return map;
}
