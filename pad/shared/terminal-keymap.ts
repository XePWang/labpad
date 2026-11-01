export type TerminalCommand='copy'|'interrupt'|'selectAll'|'home'|'end'|'wordLeft'|'wordRight'|'deleteWordLeft'|'deleteWordRight'|'eof'|'consume';
export function terminalCommand(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'|'isComposing'>,platform:string,selection:boolean,empty:boolean,running:boolean):TerminalCommand|undefined{
 if(event.isComposing)return;
 const mac=/mac|darwin/i.test(platform),win=/^win/i.test(platform),key=event.key.toLowerCase();
 if(!event.altKey&&key==='c'&&(event.ctrlKey||mac&&event.metaKey))return selection?'copy':running&&event.ctrlKey&&!event.shiftKey?'interrupt':'consume';
 if(mac&&event.metaKey&&!event.ctrlKey&&!event.altKey&&key==='a')return 'selectAll';
 if(!running)return;
 if(mac&&event.metaKey&&!event.altKey&&(key==='arrowleft'||key==='arrowright'))return key==='arrowleft'?'home':'end';
 if((mac?event.altKey:event.ctrlKey)&&!event.metaKey&&['arrowleft','arrowright','backspace','delete'].includes(key))return ({arrowleft:'wordLeft',arrowright:'wordRight',backspace:'deleteWordLeft',delete:'deleteWordRight'} as const)[key as 'arrowleft'|'arrowright'|'backspace'|'delete'];
 if(event.ctrlKey&&!event.metaKey&&!event.altKey&&(key==='d'&&empty||win&&key==='z'))return 'eof';
}
