import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('../../.work/build/electron/',import.meta.url));
await mkdir(output,{recursive:true});
await build({entryPoints:['electron/main.ts','electron/preload.ts','electron/formatter-worker.ts'],outdir:output,
 entryNames:'[name]',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node22',
 format:'cjs',external:['electron','node-pty'],sourcemap:true});
await viteBuild();
await import('./notices.mjs');

await import('./build-cli.mjs');
