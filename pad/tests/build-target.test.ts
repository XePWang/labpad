import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../core/storage';
import { defaultProblem } from '../shared/defaults';
import {
  isCodeFile,
  isHeaderFile,
  isSourceFile,
  sourceLanguage,
  editorLanguage,
} from '../shared/file-language';
import type { Draft } from '../shared/types';

test('explicit source target survives stale activation metadata, auxiliary tabs and closed source tabs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-target-'));
  try {
    const storage = new Storage(root);
    await storage.init();
    await storage.createLab('Fixture');
    const problem = defaultProblem('Fixture', 'one');
    await storage.createProblem('Fixture', 'one', 'c');
    const a = await storage.newVersion({
      source: 'int main(void){return 1;}',
      language: 'c',
      problem,
    });
    const b = await storage.newVersion({
      source: 'int main(void){return 2;}',
      language: 'c',
      problem,
    });
    await storage.activateDocument('Fixture', 'one', a.documentId!);
    const helper: Draft = {
      source: 'notes',
      language: 'c',
      problem,
      auxiliary: true,
      file: 'helper.h',
      documentId: 'aux:helper.h',
      target: {
        mode: 'problem-set',
        labId: 'Fixture',
        problemId: 'one',
        documentId: b.documentId!,
      },
    };
    assert.equal((await storage.buildTarget(helper)).documentId, b.documentId);
    assert.equal((await storage.buildTarget(helper)).source, b.source);
    assert.equal(
      (await storage.buildTarget(helper, [{ ...b, source: '// dirty B' }])).source,
      '// dirty B',
    );
    assert.equal(
      (await storage.projectState('Fixture', 'one', 'c')).activeDocumentId,
      a.documentId,
    );
    await assert.rejects(storage.buildTarget({ ...helper, target: undefined }), /选择或新建/);
    await assert.rejects(
      storage.buildTarget({
        ...helper,
        target: {
          ...helper.target!,
          mode: 'problem-set',
          problemId: 'other',
          documentId: b.documentId!,
        },
      }),
      /不一致/,
    );
    await assert.rejects(
      storage.buildTarget({
        ...helper,
        target: { mode: 'problem-set', labId: 'Fixture', problemId: 'one', documentId: 'missing' },
      }),
      /不属于/,
    );
    await storage.operateFiles('Fixture', 'one', { action: 'delete', paths: [b.file!] });
    await assert.rejects(storage.buildTarget(helper), /不存在|不属于/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('file registry separates editor language, headers and build membership', () => {
  for (const name of ['a.c', 'a.cpp', 'dir/a.cc', 'dir/a.cxx']) assert.ok(isSourceFile(name));
  for (const name of ['api.h', 'api.hh', 'api.hpp', 'api.hxx']) {
    assert.ok(isHeaderFile(name));
    assert.ok(isCodeFile(name));
    assert.ok(!isSourceFile(name));
  }
  assert.equal(sourceLanguage('main.c', 'cpp'), 'cpp');
  assert.equal(sourceLanguage('main.cpp', 'c'), 'c');
  assert.equal(editorLanguage('api.hxx'), 'cpp');
  assert.equal(editorLanguage('api.h', 'cpp'), 'cpp');
  assert.equal(sourceLanguage('notes.txt', 'cpp'), undefined);
  assert.equal(isCodeFile('LPMake.txt'), false);
});
test('workspace editor honors forced source language and opens hxx as C++', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'labpad-language-'));
  try {
    const storage = new Storage(root);
    await storage.init();
    const draft = await storage.workspace.create('Fixture', 'c');
    await storage.operateFiles('Fixture', '', {
      action: 'newFile',
      paths: ['api.hxx'],
      content: 'struct Api {};',
    });
    assert.equal((await storage.workspace.open('Fixture', 'api.hxx')).language, 'cpp');
    const make = await storage.workspace.open('Fixture', 'LPMake.txt');
    await storage.workspace.save({ ...make, source: make.source + '\nset_language("c++")\n' });
    assert.equal((await storage.workspace.open('Fixture', draft.file!)).language, 'cpp');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
