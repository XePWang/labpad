import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('../.work/build/cli',{recursive:true});
await build({alias:{tinyglobby:createRequire(import.meta.url).resolve("tinyglobby")},entryPoints:['cli/main.ts'],outfile:'../.work/build/cli/labpad.cjs',bundle:true,platform:'node',target:'node22',format:'cjs',banner:{js:'#!/usr/bin/env node'},sourcemap:false});
