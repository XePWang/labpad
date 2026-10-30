import {existsSync} from 'node:fs';
/** Bubblewrap exposes the executable and current case, not grading data or answers. */
export function sandboxCommand(executable:string,cwd:string){
 const args=['--unshare-all','--die-with-parent','--new-session','--cap-drop','ALL','--clearenv','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8'];
 for(const dir of ['/usr','/bin','/lib','/lib64'])if(existsSync(dir))args.push('--ro-bind',dir,dir);
 args.push('--dev','/dev','--tmpfs','/tmp','--dir','/app','--ro-bind',executable,'/app/program','--bind',cwd,'/work','--chdir','/work','/app/program');
 return {program:'bwrap',args};
}
