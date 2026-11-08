# Third-party notices

LabPad's original code is MIT licensed (see the repository LICENSE).
CP Editor is an interaction and design reference only. No CP Editor code or artwork is included.

- electron-vite-vue: MIT, https://github.com/electron-vite/electron-vite-vue
  Template reference revision: 8c395cda3755d542c6f90a23b1ce3e82ae440b0b.
  See TEMPLATE-LICENSE for the upstream license.
- Electron: MIT, https://github.com/electron/electron
  Chromium and other bundled notices are distributed with Electron.
- Vue, CodeMirror, xterm.js and node-pty: MIT. Their package licenses are retained.
- Splitpanes: MIT, https://github.com/antoniandre/splitpanes
- @uiw/codemirror-theme-vscode: MIT, https://github.com/uiwjs/react-codemirror
- @wasm-fmt/clang-format 23.1.1: MIT JavaScript wrapper, https://github.com/wasm-fmt/clang-format
  Its LLVM WASM engine uses Apache-2.0 WITH LLVM-exception; see vendor/llvm/.
  The full LLVM license is included in packaged THIRD_PARTY_LICENSES.txt.
- write-file-atomic: ISC, https://github.com/npm/write-file-atomic
- jsdiff: BSD-3-Clause, https://github.com/kpdecker/jsdiff
- iconv-lite: MIT, https://github.com/ashtuchkin/iconv-lite
- tree-kill: MIT, https://github.com/pkrumins/node-tree-kill
- testlib: MIT, https://github.com/MikeMirzayanov/testlib
  The pinned source revision and license are in vendor/testlib/.
- Zig: https://ziglang.org/
  The native-target toolchain retains its own LICENSE and third-party notices.
  The toolchain as a whole is not relabeled MIT.

Distribution includes the relevant dependency notices. Runtime dependencies are
bundled with the application; students do not need the development tools.

CLI additionally uses SheetJS CE (Apache-2.0), csv-parse / csv-stringify (MIT), and yauzl (MIT). Their license texts are included in the generated licenses directory.

## Xterm Readline

The terminal line editor adapts xterm-readline 1.3.1 (MIT), revision 0870644ef26f2864b837bc535c2df60a87262a87. Its source, license, pin and LabPad changes are in vendor/xterm-readline. The distributed THIRD_PARTY_LICENSES.txt includes the MIT license.

## Offline debugger

- CodeLLDB 1.12.3: MIT, https://github.com/vadimcn/codelldb/tree/v1.12.3.
- Its LLDB/LLVM runtime: Apache-2.0 WITH LLVM-exception.
- Bundled Python 3.12.7: Python Software Foundation License and included third-party notices.

The pinned downloads are in debuggers.json; license texts are in vendor/codelldb, vendor/llvm and vendor/python, and resources/debugger/licenses.

## Editor font

JetBrains Mono 2.304 (OFL-1.1), https://github.com/JetBrains/JetBrainsMono/tree/v2.304. The unmodified WOFF2 font is bundled for offline use. Its license and download hashes are retained in vendor/jetbrains-mono and the packaged THIRD_PARTY_LICENSES.txt.
