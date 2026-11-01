import {test} from '@playwright/test';import {_electron} from 'playwright';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{runCompileFlowScenario}=require('./compile-flow-scenario.cjs');
test('compile/save/test separation and inline terminal',async()=>{await runCompileFlowScenario(_electron,{cwd:process.cwd(),evidence:path.resolve('../.work/dev8-compile-flow-ui')});});test.setTimeout(300000);
