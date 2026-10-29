import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runCompilerScenario}=createRequire(import.meta.url)('./compiler-scenario.cjs');
test('compiler detection, manual selection, profiles and empty result',async()=>{
 await runCompilerScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/compiler-results')});
});
