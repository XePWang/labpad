import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runScenario}=createRequire(import.meta.url)('./scenario.cjs');
test('project selection, saving modes, debug, path validation and data relocation',async()=>{
 await runScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/ui-results')});
});
