import {withFixtures} from './legacy-flow.cjs';
import {test,_electron} from '@playwright/test';import {createRequire} from 'node:module';import path from 'node:path';
const {runBuildSettingsScenario}=createRequire(import.meta.url)('./build-settings-scenario.cjs');
test('parameter source: 18 native workflow groups',async()=>{test.setTimeout(420000);await runBuildSettingsScenario(withFixtures(_electron),{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/dev8-build-settings-ui')});});
