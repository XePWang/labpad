import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runResourcesScenario}=createRequire(import.meta.url)('./resources-scenario.cjs');
test('close shortcuts, recorder, repeated process lifecycle, memory, relocation and scale extremes',async()=>{
 await runResourcesScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/ui-results')});
});
