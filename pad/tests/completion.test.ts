import test from 'node:test';import assert from 'node:assert/strict';import {EditorState} from '@codemirror/state';import {cpp} from '@codemirror/lang-cpp';import {CompletionContext} from '@codemirror/autocomplete';import {declarations,includedOptions,sourceCompletions} from '../src/editor/completion';
test('completion declarations respect lexical scopes and include availability',()=>{const text='int global; int f(int n){int local=0; for(int i=0;i<n;++i){local+=i;} return local;} int g(void){int hidden=1;return hidden;}';
 const pos=text.indexOf('return local'),names=declarations(text,pos).map(v=>v.label);assert.ok(names.includes('global'));assert.ok(names.includes('n'));assert.ok(names.includes('local'));assert.ok(!names.includes('i'));assert.ok(!names.includes('hidden'));
 const options=includedOptions('#include "api.h"\n#include <stdio.h>','main.c',{files:{'api.h':'int helper(int input);'},includeDirs:['.']});assert.ok(options.some(o=>o.label==='helper'));assert.ok(options.some(o=>o.label==='printf'));assert.ok(!options.some(o=>o.label==='malloc'));
 assert.ok(!includedOptions('', 'main.c',{files:{'api.h':'int hidden(void);'},includeDirs:['.']}).length);
 const shadow=includedOptions('#include "stdio.h"','main.c',{files:{'stdio.h':'int localprint(void);'},includeDirs:['.']});assert.ok(shadow.some(o=>o.label==='localprint'));assert.ok(!shadow.some(o=>o.label==='printf'));
});
test('completion ignores comments and strings, returns short placeholders',()=>{for(const text of ['// int abc','"printf']){const state=EditorState.create({doc:text,extensions:[cpp()]});assert.equal(sourceCompletions(new CompletionContext(state,text.length,false),'main.c',{files:{},includeDirs:['.']},'c'),null);}
 const state=EditorState.create({doc:'fo',extensions:[cpp()]}),result=sourceCompletions(new CompletionContext(state,2,false),'main.c',{files:{},includeDirs:['.']},'c');assert.ok(result?.options.some(o=>o.label==='for'));assert.ok(!result?.options.some(o=>o.label==='concept'));
});
