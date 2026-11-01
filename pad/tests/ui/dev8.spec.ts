import {withFixtures} from './legacy-flow.cjs';
import {test,_electron} from '@playwright/test';import {createRequire} from 'node:module';import path from 'node:path';
const {runDev8Scenario}=createRequire(import.meta.url)('./dev8-scenario.cjs');
test('dev8 workspace, import patch, export reconstruction and compact UI flows',async()=>{await runDev8Scenario(withFixtures(_electron),{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/ui-results')});});
