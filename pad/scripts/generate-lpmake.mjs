import {buildParserFile} from '@lezer/generator';import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../shared/',import.meta.url),grammar=await readFile(new URL('lpmake.grammar',root),'utf8'),files=buildParserFile(grammar,{typeScript:true});
await writeFile(new URL('lpmake-parser.ts',root),files.parser);await writeFile(new URL('lpmake-parser.terms.ts',root),files.terms);
