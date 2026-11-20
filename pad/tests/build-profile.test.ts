import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../shared/defaults';
import { problemSetCompiler } from '../core/build/profile';

test('build profiles select a unique optimization level for the active language and linker', () => {
  const config = {
    ...defaultConfig().compiler,
    cArgs: ['-O3', '-Wall', '-I', 'an include directory', '-Xclang', '-O1'],
    cppArgs: ['-std=c++20', '@cpp.rsp'],
    linkArgs: ['-lm', '-O0', '-Ofast', '--optimize=2'],
  };
  const release = problemSetCompiler(config, 'c', 'release');
  assert.deepEqual(release.cArgs, ['-Wall', '-I', 'an include directory', '-O2']);
  assert.deepEqual(release.linkArgs, ['-lm']);
  assert.deepEqual(release.cppArgs, config.cppArgs);
  assert.ok(config.cArgs.includes('-O3'));
  assert.throws(() => problemSetCompiler(config, 'cpp', 'debug'), /cpp\.rsp/);
});

test('debug builds keep symbols and separate their Zig caches from ordinary builds', () => {
  const config = {
    ...defaultConfig().compiler,
    cppArgs: ['-std=c++20', '-O3', '-flto=thin', '-g0', '-gline-tables-only', '-DLEVEL=2'],
    linkArgs: ['-s', '-Wl,--strip-debug,-lm', '-Xlinker', '--strip-all'],
  };
  const debug = problemSetCompiler(config, 'cpp', 'debug');
  const debugSession = problemSetCompiler(config, 'cpp', 'debug', true);
  const release = problemSetCompiler(config, 'cpp', 'release');
  const releaseSession = problemSetCompiler(config, 'cpp', 'release', true);
  assert.deepEqual(debug.cppArgs, ['-std=c++20', '-DLEVEL=2', '-g', '-O0']);
  assert.deepEqual(debug.linkArgs, ['-Wl,-lm']);
  assert.ok(releaseSession.cppArgs.includes('-O2'));
  assert.ok(releaseSession.cppArgs.includes('-g'));
  assert.ok(releaseSession.cppArgs.includes('-flto=thin'));
  assert.deepEqual(releaseSession.linkArgs, debugSession.linkArgs);
  assert.deepEqual(release.linkArgs, config.linkArgs);
  assert.equal(
    new Set([debug, debugSession, release, releaseSession].map((value) => value.cacheScope)).size,
    4,
  );
});
