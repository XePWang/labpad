export const shortcutActions=[
 ['run','编译并运行',['F9','Control+Enter']],['save','保存当前',['$mod+KeyS']],['saveAll','保存全部',['$mod+Shift+KeyS']],
 ['format','格式化代码',['Shift+Alt+KeyF']],['close','关闭标签',['Control+F4']],['closeSaved','关闭已保存',['$mod+KeyK KeyU']],
 ['closeAll','关闭全部标签',['$mod+KeyK KeyW']],['next','下一个标签',['Control+Tab']],['previous','上一个标签',['Control+Shift+Tab']],
 ['copyPath','复制路径',['Shift+Alt+KeyC']],['copyRelativePath','复制相对路径',['Control+Shift+Alt+KeyC']],['interrupt','中断调试',['Control+KeyC']],
 ['newSource','新建源码',['$mod+KeyN']],['importSource','导入源码',['$mod+KeyO']],['settings','设置',['$mod+Comma']],['reopen','恢复最近源码',['$mod+Shift+KeyT']]
] as const;
export function macPlatform(platform?:string){return /mac|darwin/i.test(platform??(typeof navigator!=='undefined'?navigator.platform:process.platform));}
export function defaultShortcuts(platform?:string):Record<string,string[]>{
 const value:Record<string,string[]>=Object.fromEntries(shortcutActions.map(([id,,keys])=>[id,[...keys]]));
 if(macPlatform(platform))Object.assign(value,{saveAll:['$mod+Alt+KeyS'],close:['$mod+KeyW'],copyPath:['$mod+KeyK KeyP'],copyRelativePath:[]});
 return value;
}
export function migrateShortcuts(value?:Record<string,string[]>,platform?:string){
 const defaults=defaultShortcuts(platform),legacy=Object.fromEntries(shortcutActions.map(([id,,keys])=>[id,[...keys]]));
 if(!value)return defaults;
 for(const [id,keys] of Object.entries(value))if(id in defaults){
  defaults[id]=macPlatform(platform)&&JSON.stringify(keys)===JSON.stringify(legacy[id])?defaults[id]:keys;
 }
 return defaults;
}
export function validateShortcuts(value:unknown,platform?:string):Record<string,string[]>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('快捷键设置无效');
 const map=value as Record<string,string[]>,used:string[]=[],mod=macPlatform(platform)?'meta':'control';
 for(const [id] of shortcutActions){
  const keys=map[id];if(!Array.isArray(keys)||keys.length>3||keys.some(k=>typeof k!=='string'||!k.trim()))throw new Error('快捷键设置无效：'+id);
  for(const key of keys){
   const parts=key.trim().split(' ');
   if(parts.length>2||parts.some(p=>!/^((\$mod|Control|Alt|Shift|Meta)\+)*([A-Za-z][A-Za-z0-9]*|[0-9])$/.test(p)))throw new Error('快捷键格式无效：'+key);
   const canonical=parts.map(p=>{const bits=p.toLowerCase().replace(/\$mod/g,mod).split('+'),last=bits.pop();return bits.sort().join('+')+'+'+last;}).join(' ');
   if(used.some(k=>k===canonical||k.startsWith(canonical+' ')||canonical.startsWith(k+' ')))throw new Error('快捷键重复或前缀冲突：'+key);
   if(/^(alt\+f4|alt\+control\+delete|meta\+key[qhm])$/.test(canonical))throw new Error('该组合键由系统使用：'+key);used.push(canonical);
  }
 }
 return map;
}
