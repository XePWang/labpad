module.exports = {
 appId:'cn.xep.labpad',productName:'LabPad',executableName:'LabPad',
 directories:{output:'../.work/release'},
 extraMetadata:{main:'electron/main.cjs',type:'commonjs'},
 files:[{from:'../.work/build',to:'.',filter:['electron/**','renderer/**','licenses/**']},
 'package.json','node_modules/node-pty/**','!node_modules/node-addon-api/**','!node_modules/node-pty/src/**','!node_modules/node-pty/deps/**','!node_modules/node-pty/third_party/**','!node_modules/node-pty/test/**','!node_modules/node-pty/build/obj*/**','!node_modules/node-pty/build/Makefile','!node_modules/node-pty/build/*.mk','!node_modules/node-pty/build/config.gypi'],
 asarUnpack:['node_modules/node-pty/**','node_modules/@wasm-fmt/**'],
 extraResources:[
 {from:'../.work/build/electron/formatter-worker.cjs',to:'formatter-worker.cjs'},
 {from:'../.work/staged-toolchains/\u0024{os}-\u0024{arch}',to:'toolchain'},
 {from:'../.work/debuggers/\u0024{os}-\u0024{arch}',to:'debugger'},
 {from:'../.work/checkers/\u0024{os}-\u0024{arch}',to:'checkers'},
 {from:'THIRD_PARTY_NOTICES.md',to:'THIRD_PARTY_NOTICES.md'},
 {from:'assets/icon.png',to:'icon.png'}],
 beforePack:async context=>{const name={win32:'win',darwin:'mac',linux:'linux'}[context.electronPlatformName],arch=require('builder-util').Arch[context.arch],target=name+'-'+arch;await (await import('./scripts/stage-toolchain.mjs')).stageToolchain(target);await (await import('./scripts/prepare-debugger.mjs')).prepareDebugger(target);},
 npmRebuild:false,artifactName:'LabPad-\u0024{version}-\u0024{os}-\u0024{arch}.\u0024{ext}',
 afterPack:async context=>(await import('./scripts/sign-mac-dev.mjs')).default(context),
 linux:{target:['tar.gz'],category:'Development',icon:'assets/icon.png'},win:{target:['zip'],icon:'assets/icon.ico',signExecutable:false},
 mac:{target:['zip'],category:'public.app-category.developer-tools',identity:null,icon:'assets/icon.icns'},
 publish:{provider:'github',owner:'XePWang',repo:'labpad',releaseType:'prerelease'}
};
