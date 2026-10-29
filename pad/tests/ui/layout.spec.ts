import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runLayoutScenario}=createRequire(import.meta.url)('./layout-scenario.cjs');
test('compact toolbar, contextual status, splitters, terminal fit and layout persistence',async()=>{
 await runLayoutScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/layout-results')});
});
