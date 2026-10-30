import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('../.work/build/cli',{recursive:true});
await build({entryPoints:['cli/main.ts'],outfile:'../.work/build/cli/labpad.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',banner:{js:'#!/usr/bin/env node'},sourcemap:false});
