import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/ui',timeout:180000,workers:1,retries:0,
 outputDir:'../.work/ui-results',reporter:[['list']],
 use:{trace:'retain-on-failure'}
});
