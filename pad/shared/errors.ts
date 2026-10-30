/** Strip Electron's IPC wrapper while keeping the application's actual error. */
export function operationError(value:unknown):string{
 let text=value instanceof Error?value.message:String(value);
 text=text.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/,'').replace(/^(?:Error:\s*)+/, '');
 return text;
}
