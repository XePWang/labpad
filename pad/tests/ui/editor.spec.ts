import {test,_electron} from '@playwright/test';
import {createRequire} from 'node:module';
import path from 'node:path';
const {runEditorScenario}=createRequire(import.meta.url)('./editor-scenario.cjs');
test('native editor keys, atomic undo, themes, WASM formatting and saves',async()=>{
 await runEditorScenario(_electron,{executable:process.env.LABPAD_TEST_EXECUTABLE,cwd:process.cwd(),evidence:path.resolve('../.work/editor-results')});
});
