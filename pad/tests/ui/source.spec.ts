import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runSourceScenario}=createRequire(import.meta.url)('./source-scenario.cjs');
test('new C/C++ sources after closing all tabs and unified owned imports',async()=>{
 await runSourceScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/ui-results')});
});
