const path=require('node:path'),fs=require('node:fs/promises'),{_electron}=require('playwright');
const entries=[
 ['compiler','compiler-scenario.cjs','runCompilerScenario'],['workspace','scenario.cjs','runScenario'],['editor','editor-scenario.cjs','runEditorScenario'],['layout','layout-scenario.cjs','runLayoutScenario'],['project','project-scenario.cjs','runProjectScenario'],['resources','resources-scenario.cjs','runResourcesScenario'],['source','source-scenario.cjs','runSourceScenario']
];
(async()=>{
 const executable=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]),only=process.argv[4];
 await fs.access(executable);await fs.mkdir(evidence,{recursive:true});
 let count=0;
 for(const [name,module,fn] of entries){if(only&&name!==only)continue;console.log('SCENARIO '+name);await require('./'+module)[fn](_electron,{executable,cwd:path.dirname(executable),evidence:path.join(evidence,name)});count++;}
 if(!count)throw Error('Unknown scenario');console.log('PACKAGED DESKTOP PASSED '+count+' scenarios on '+process.platform);
})().catch(e=>{console.error(e);process.exitCode=1;});
