export type DesktopPlatform='win32'|'linux'|'darwin';
export function nativeButtonOrder(count:number,cancelId:number,platform:DesktopPlatform):number[]{
 const positive=Array.from({length:count},(_,i)=>i).filter(i=>i!==cancelId);
 // NSAlert places its first action at the trailing edge; GTK follows the supplied order.
 return platform==='linux'?[cancelId,...positive.reverse()]:[...positive,cancelId];
}
export function windowsActions(platform:string){return /^win/i.test(platform);}
