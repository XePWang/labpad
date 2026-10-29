import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import electron from 'electron';
const output=fileURLToPath(new URL('../../.work/build/electron/',import.meta.url));
await build({entryPoints:['electron/main.ts','electron/preload.ts'],outdir:output,entryNames:'[name]',
 outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',format:'cjs',external:['electron','node-pty'],sourcemap:true});
const server=await createServer();await server.listen();
const child=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,VITE_DEV_SERVER_URL:'http://127.0.0.1:5173'}});
child.once('exit',async code=>{await server.close();process.exit(code??0);});
