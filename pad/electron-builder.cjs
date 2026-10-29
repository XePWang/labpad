module.exports = {
 appId:'cn.xep.labpad',productName:'LabPad',executableName:'LabPad',
 directories:{output:'../.work/release'},
 extraMetadata:{main:'electron/main.cjs',type:'commonjs'},
 files:[{from:'../.work/build',to:'.',filter:['electron/**','renderer/**','licenses/**']},
 'package.json','node_modules/node-pty/**','node_modules/node-addon-api/**'],
 asarUnpack:['node_modules/node-pty/**'],
 extraResources:[
 {from:'../.work/toolchains/\u0024{os}-\u0024{arch}',to:'toolchain'},
 {from:'../.work/checkers/\u0024{os}-\u0024{arch}',to:'checkers'},
 {from:'THIRD_PARTY_NOTICES.md',to:'THIRD_PARTY_NOTICES.md'},
 {from:'assets/icon.png',to:'icon.png'}],
 npmRebuild:false,artifactName:'LabPad-\u0024{version}-\u0024{os}-\u0024{arch}.\u0024{ext}',
 afterPack:async context=>(await import('./scripts/sign-mac-dev.mjs')).default(context),
 linux:{target:['tar.gz'],category:'Development',icon:'assets/icon.png'},win:{target:['zip'],icon:'assets/icon.ico',signExecutable:false},
 mac:{target:['zip'],category:'public.app-category.developer-tools',identity:null,icon:'assets/icon.icns'},
 publish:{provider:'github',owner:'XePWang',repo:'labpad',releaseType:'prerelease'}
};
