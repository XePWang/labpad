import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runProjectScenario}=createRequire(import.meta.url)('./project-scenario.cjs');
test('project import/export, snapshot warnings, cancellation and metadata',async()=>{await runProjectScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/ui-results')});});
