import { test, expect } from '@playwright/test';
import { qualityFixture } from './quality-fixture';
import { compileOnly } from './legacy-flow.cjs';
type Tool = { name: string; kind: 'gcc' | 'clang'; cPath: string; cppPath: string };
const tools: Tool[] = JSON.parse(process.env.LABPAD_TEST_TOOLCHAINS ?? '[]');
for (const tool of tools)
  test(
    'external ' + tool.name + ' supports single sources, projects, terminal and native debug',
    async () => {
      test.setTimeout(240000);
      const { app, page, root, close } = await qualityFixture();
      const checks: string[] = [];
      const record = (name: string) => {
        checks.push(name);
        console.log('TOOLCHAIN_PASS ' + tool.name + ' ' + name);
      };
      const bootstrap = () => page.evaluate(() => window.labpad.bootstrap());
      const terminalText = () => page.locator('.xterm-rows').innerText();
      const reload = async () => {
        await page.reload();
        await page.locator('.toolbar').waitFor();
        await page.evaluate(() => {
          const w = window as any;
          w.__toolCompilation = undefined;
          w.__toolOutput = '';
          w.__toolNative = { status: 'idle' };
          w.__toolTerminal = { status: 'exited' };
          window.labpad.onJudge((e) => {
            if (e.type === 'compilation') w.__toolCompilation = e.compilation;
          });
          window.labpad.onDebugData((data, ack) => {
            w.__toolOutput += data;
            ack();
          });
          window.labpad.onDebugState((state) => (w.__toolTerminal = state));
          window.labpad.onNativeState((state) => (w.__toolNative = state));
        });
      };
      const saveSource = async (
        code: string,
        language: 'c' | 'cpp',
        newVersion = false,
        expected = 'ok\n',
        comparison: any = { type: 'wcmp' },
      ) => {
        if (newVersion) {
          const previous = (await bootstrap()).draft.documentId;
          await page.getByRole('button', { name: '新建源码', exact: true }).click();
          await page
            .getByRole('menuitem', {
              name: language === 'cpp' ? 'C++ 源码（.cpp）' : 'C 源码（.c）',
              exact: true,
            })
            .click();
          await expect.poll(async () => (await bootstrap()).draft.documentId).not.toBe(previous);
        }
        await expect.poll(async () => (await bootstrap()).draft.language).toBe(language);
        await page.locator('.cm-content').fill(code);
        await page.keyboard.press('Control+s');
        await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
        await expect.poll(async () => (await bootstrap()).draft.source).toBe(code);
        await page.evaluate(
          async ({ expected, comparison }) => {
            const b = await window.labpad.bootstrap();
            await window.labpad.saveProblem({
              ...b.draft.problem,
              timeLimitMs: 3000,
              outputLimitBytes: 4096,
              comparison,
              testCases: [{ id: 'main', input: '9\n', expectedOutput: expected }],
            });
          },
          { expected, comparison },
        );
        await reload();
        expect((await bootstrap()).draft.source).toBe(code);
      };
      const compile = async (status = 'success') => {
        await page.evaluate(() => {
          (window as any).__toolCompilation = undefined;
        });
        await compileOnly(page, 'F9');
        const c = await page.evaluate(() => (window as any).__toolCompilation);
        expect(c, await page.locator('.output-log').innerText()).toBeTruthy();
        expect(c.status, c.stderr).toBe(status);
        expect(c.stderr).not.toContain("'-x none' after last input file has no effect");
        if (c.status === 'success' && c.command && !c.commands) {
          const source = c.command.find((value: string) => /\.(c|cpp)$/.test(value));
          const compiledSource = await app.evaluate(
            async (_, file) => process.getBuiltinModule('fs/promises')!.readFile(file, 'utf8'),
            source,
          );
          expect(compiledSource, 'actual compiled source must match the saved editor').toBe(
            (await bootstrap()).draft.source,
          );
        }
        return c;
      };
      const run = async (verdict: string) => {
        const result = await page.evaluate(async () =>
          window.labpad.judge((await window.labpad.bootstrap()).draft),
        );
        expect(result.cases[0]?.verdict, JSON.stringify(result)).toBe(verdict);
        return result;
      };
      const saveProjectFile = async (lab: string, file: string, source: string) => {
        expect((await bootstrap()).draft.problem.labId).toBe(lab);
        await page.locator('.tree-file[data-file=\"' + file + '\"]').click();
        await expect.poll(async () => (await bootstrap()).draft.file).toBe(file);
        await page.locator('.cm-content').fill(source);
        await page.keyboard.press('Control+s');
        await expect(page.locator('.source-tab.active .save-status')).toHaveText('已保存');
        await expect.poll(async () => (await bootstrap()).draft.source).toBe(source);
      };
      try {
        await app.evaluate(({ dialog }, root) => {
          const path = process.getBuiltinModule('path')!;
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: path.join(root, 'submission.zip'),
          });
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [path.join(root, 'submission.zip')],
          });
          dialog.showMessageBox = async (...args: any[]) => {
            const options = args.at(-1);
            for (const label of ['保存并编译', '导入副本', '导入', '继续调试']) {
              const response = options.buttons.indexOf(label);
              if (response >= 0) return { response, checkboxChecked: false };
            }
            return { response: options.cancelId ?? 0, checkboxChecked: false };
          };
        }, root);
        await page.evaluate(async () => {
          const b = await window.labpad.bootstrap();
          b.config.formatOnSave = false;
          b.config.classId = '9527';
          b.config.name = '样例同学';
          b.config.studentId = '7355608';
          await window.labpad.saveConfig(b.config, b.dataRoot);
        });
        await reload();
        await page.locator('.settings-button').click();
        await page
          .getByRole('combobox', { name: '编译器使用方式', exact: true })
          .selectOption('custom');
        await page
          .getByRole('combobox', { name: '编译器类型', exact: true })
          .selectOption(tool.kind);
        await page.getByRole('textbox', { name: 'C 编译器路径', exact: true }).fill(tool.cPath);
        await page.getByRole('textbox', { name: 'C++ 编译器路径', exact: true }).fill(tool.cppPath);
        await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect(page.locator('.settings-dialog')).toHaveCount(0);
        const selected = (await bootstrap()).config.compiler;
        expect(selected.cPath).toBe(tool.cPath);
        expect(selected.cppPath).toBe(tool.cppPath);
        const version = await page.evaluate((c) => window.labpad.compilerInfo(c), selected);
        console.log('TOOLCHAIN_VERSION ' + JSON.stringify({ tool, version }));
        record('settings paths persist and the selected real compiler reports its identity');
        await page.evaluate(async (name) => {
          await window.labpad.createLab('单文件 ' + name, 'problem-set');
          await window.labpad.createProblem('单文件 ' + name, 'Lab X-1', 'c');
        }, tool.kind);
        await reload();
        await saveSource(
          '#include <stdio.h>\n#include <math.h>\n#if __STDC_VERSION__ != 201710L\n#error C17_required\n#endif\nint main(void){double n;scanf("%lf",&n);printf("root %.6f 中文\\n",sqrt(n));}\n',
          'c',
          false,
          'root 3.000000 中文\n',
          { type: 'floatTokens', absoluteTolerance: 1e-5, relativeTolerance: 1e-5 },
        );
        let c = await compile();
        expect(c.command[0]).toBe(tool.cPath);
        await run('AC');
        record('C17, math linking, UTF-8 output and floating comparison');
        await saveSource(
          '#include <iostream>\n#include <span>\nstatic_assert(__cplusplus==202002L);\nint main(){int a[]={42};std::span<int> s(a);std::cout<<"cpp "<<s[0]<<" 中文\\n";}\n',
          'cpp',
          true,
          'cpp 42 中文\n',
        );
        c = await compile();
        expect(c.command[0]).toBe(tool.cppPath);
        await run('AC');
        record('C++20 span, standard-library runtime and UTF-8 output');
        await saveSource('#include <stdio.h>\nint main(void){puts("wrong");}\n', 'c', true);
        await compile();
        await run('WA');
        record('WA is reported for mismatched output');
        await saveSource('int main(void){return 7;}\n', 'c');
        await compile();
        await run('RE');
        record('nonzero exit is reported as RE');
        await saveSource('int main(void){volatile unsigned long x=0;for(;;)x++;}\n', 'c');
        await compile();
        await run('TLE');
        record('time limit stops the real compiled process');
        await saveSource(
          '#include <stdio.h>\nint main(void){for(;;)fputs("0123456789abcdef",stdout);}\n',
          'c',
        );
        await compile();
        await run('OLE');
        record('output limit stops the real compiled process');
        await saveSource('int main(void){return unknown_symbol;}\n', 'c');
        await compile('CE');
        expect(
          (
            await page.evaluate(async () =>
              window.labpad.compileState((await window.labpad.bootstrap()).draft),
            )
          ).ready,
        ).toBe(false);
        record('CE clears readiness and keeps compiler diagnostics');
        await saveSource(
          '#include <stdio.h>\nint main(void){setvbuf(stdout,0,_IONBF,0);puts("ready中文");char s[100];while(fgets(s,sizeof s,stdin)){printf("回声:%s",s);}}\n',
          'c',
        );
        await page.evaluate(async () => {
          const b = await window.labpad.bootstrap();
          await window.labpad.saveProblem({ ...b.draft.problem, testCases: [] });
        });
        await reload();
        await compile();
        await expect.poll(terminalText, { timeout: 30000 }).toContain('ready中文');
        await page.locator('.xterm-helper-textarea').focus();
        await page.keyboard.type('hello');
        await page.keyboard.press('Enter');
        await expect.poll(terminalText).toContain('回声:hello');
        await page.keyboard.insertText('你好');
        await page.keyboard.press('Enter');
        await expect.poll(terminalText).toContain('回声:你好');
        await page.keyboard.press('Control+c');
        await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
        record('interactive terminal input/output and Ctrl+C release execution ownership');
        const lab = '工程 ' + tool.kind;
        await page.evaluate((name) => window.labpad.createLab(name, 'project'), lab);
        await reload();
        const scope = (await bootstrap()).workspace!.scope;
        await page.evaluate(async (lab) => {
          for (const [name, content] of [
            ['app.cpp', ''],
            [
              'api.h',
              '#ifdef __cplusplus\nextern "C" {\n#endif\nint add(int,int);\n#ifdef __cplusplus\n}\n#endif\n',
            ],
          ])
            await window.labpad.fileOperation(lab, '', {
              action: 'newFile',
              paths: [name],
              content,
            });
        }, lab);
        await app.evaluate(async (_, scope) => {
          const fs = process.getBuiltinModule('fs/promises')!,
            path = process.getBuiltinModule('path')!;
          await fs.writeFile(path.join(scope, 'payload.bin'), Buffer.from([0, 65, 255]));
        }, scope);
        await reload();
        await saveProjectFile(
          lab,
          'LPMake.txt',
          'target("matrix")\nset_standard("c17")\nset_standard("c++20")\nset_mode("debug")\nadd_includedirs("./")\nadd_files("./*.c", "./*.cpp")\nadd_cflags("-Wall", "-Wextra")\nadd_cxxflags("-Wall", "-Wextra")\nadd_links("m")\n',
        );
        await saveProjectFile(
          lab,
          'main.c',
          '#include "api.h"\n#include <math.h>\nint add(int a,int b){double sum=(double)a+b;return (int)sqrt(sum*sum);}\n',
        );
        const projectSource =
          '#include <cstdio>\n#include <span>\n#include "api.h"\nint main(){int n=0;std::scanf("%d",&n);int a[]={n};std::span<int> s(a);unsigned char b[3];FILE*f=std::fopen("payload.bin","rb");if(!f)return 8;auto size=std::fread(b,1,3,f);std::fclose(f);std::printf("sum:%d bytes:%zu\\n",add(s[0],2),size);return b[2]==255?0:9;}\n';
        await saveProjectFile(lab, 'app.cpp', projectSource);
        await page.evaluate(async () => {
          const b = await window.labpad.bootstrap();
          await window.labpad.saveProblem({
            ...b.draft.problem,
            timeLimitMs: 1000,
            outputLimitBytes: 4096,
            comparison: { type: 'strictText', ignoreFinalNewlines: true },
            testCases: [{ id: 'project', input: '40\n', expectedOutput: 'sum:42 bytes:3\n' }],
          });
        });
        await reload();
        c = await compile();
        expect(c.commands[0][0]).toBe(tool.cppPath);
        expect(c.commands.some((args: string[]) => args[0] === tool.cPath)).toBe(true);
        expect(c.commands.at(-1)[0]).toBe(tool.cppPath);
        await run('AC');
        record('mixed C/C++ objects, header lookup, math, C++ linker and binary resources');
        const debugSource =
          '#include <cstdio>\n#include "api.h"\nint main(){\n int total=0;\n for(int i=0;i<3;i++){\n  total=add(total,i);\n }\n std::printf("total:%d\\n",total);\n return 0;\n}\n';
        await saveProjectFile(lab, 'app.cpp', debugSource);
        await reload();
        const start = async () => {
          await page.evaluate(async () => {
            (window as any).__toolNative = { status: 'idle' };
            await window.labpad.nativeStart((await window.labpad.bootstrap()).draft, [
              { path: 'app.cpp', line: 6, enabled: true, condition: 'i == 1' },
            ]);
          });
          await expect
            .poll(() => page.evaluate(() => (window as any).__toolNative.status), {
              timeout: 30000,
            })
            .toBe('paused');
        };
        await start();
        let state = await page.evaluate(() => (window as any).__toolNative);
        expect(state.breakpoints[0].verified).toBe(true);
        expect(state.conditionalBreakpoints).toBe(true);
        let watch = await page.evaluate(
          (id) => window.labpad.nativeWatch('i', id),
          state.inspectionId,
        );
        expect(watch.value).toBe('1');
        await page.evaluate(() => window.labpad.nativeControl('stepIn'));
        await expect
          .poll(() => page.evaluate(() => (window as any).__toolNative.frames?.[0]?.path), {
            timeout: 30000,
          })
          .toMatch(/main\.c$/);
        record('verified conditional breakpoint, variables/watch and stepping from C++ into C');
        await page.evaluate(() => window.labpad.nativeStop());
        await expect(page.getByRole('button', { name: '编译', exact: true })).toBeEnabled();
        await start();
        await page.evaluate(() => window.labpad.nativeControl('continue'));
        await expect
          .poll(() => page.evaluate(() => (window as any).__toolNative.status), { timeout: 30000 })
          .toBe('ended');
        record('native stop, rebuild/restart and normal exit restore controls');
        await saveProjectFile(lab, 'app.cpp', projectSource);
        await reload();
        let result = await page.evaluate(async () =>
          window.labpad.terminalCommand((await window.labpad.bootstrap()).draft, 'lpmake b'),
        );
        expect(result.output).toContain('构建完成');
        await page.evaluate(async () => {
          await window.labpad.terminalCommand((await window.labpad.bootstrap()).draft, 'lpmake r');
          window.labpad.debugInput('40\r');
        });
        await expect.poll(terminalText, { timeout: 30000 }).toContain('sum:42 bytes:3');
        await expect
          .poll(() => page.evaluate(() => (window as any).__toolTerminal.status))
          .toBe('exited');
        result = await page.evaluate(async () =>
          window.labpad.terminalCommand((await window.labpad.bootstrap()).draft, 'lpmake c'),
        );
        expect(result.output).toContain('已清理');
        record('lpmake build/run/clean uses the selected drivers and owned project output');
        const formatted = await page.evaluate(() =>
          window.labpad.formatCode('int main(void){return 0;}', 'c', 4),
        );
        expect(formatted).toContain('    return 0;');
        record('offline formatting remains available with custom compilers');
        await compile();
        await run('AC');
        await page.evaluate(async () => {
          const b = await window.labpad.bootstrap();
          const preview = await window.labpad.exportPreview('project', [b.draft], true);
          await window.labpad.writeExport(preview);
        });
        const restored = await page.evaluate(() => window.labpad.importProject());
        expect(restored?.workspace).toBeTruthy();
        await reload();
        await compile();
        await run('AC');
        record(
          'ZIP with build configuration reconstructs and passes under the same selected toolchain',
        );
        const before = (await bootstrap())
          .workspace!.files.map((f) => f.path)
          .filter((p) => !p.startsWith('build/'));
        await page.evaluate(() => window.labpad.clearCache());
        await compile();
        await run('AC');
        expect(
          (await bootstrap())
            .workspace!.files.map((f) => f.path)
            .filter((p) => !p.startsWith('build/')),
        ).toEqual(before);
        record('cache cleanup preserves sources and permits a fresh successful build');
        await app.evaluate(
          async (_, value) => {
            const fs = process.getBuiltinModule('fs/promises')!,
              path = process.getBuiltinModule('path')!;
            const p = path.resolve(
              '../.work/rc1-final-audit',
              'toolchain-' + process.platform + '-' + value.kind + '.json',
            );
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, JSON.stringify(value, null, 2));
          },
          { kind: tool.kind, version, checks },
        );
      } catch (error) {
        console.log(
          'TOOLCHAIN_FAILURE ' + tool.name + ' ' + (await page.locator('.output-log').innerText()),
        );
        console.log(
          'TOOLCHAIN_NATIVE ' +
            JSON.stringify(await page.evaluate(() => (window as any).__toolNative)),
        );
        console.log('TOOLCHAIN_SAVED_SOURCE ' + JSON.stringify((await bootstrap()).draft));
        throw error;
      } finally {
        await close();
      }
    },
  );
