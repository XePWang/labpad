# LabPad

C 语言实验的离线自测桌面工具。当前只发布 **dev 预发布版本**。

左侧编辑单文件源码，右侧查看测试点，底部切换“输出 / 调试”。没有测试点时，点击“编译并运行”：编译成功后进入可交互输入的调试页，编译失败时显示原始输出。

- 实验项目和题号通过下拉菜单选择；菜单内可新建，导入题目 JSON 也会加入项目列表。未分配时显示 <无>。
- 默认手动保存，支持 Ctrl+S；设置页可切换自动保存。打开已有源码后，保存直接写回原文件。
- 原生 CodeMirror 编辑器显示淡色空格点，支持 1 / 2 / 4 空格缩进、选中行缩进与语法树上下文缩进；设置页提供亮色和暗色主题。
- 内置 WASM clang-format，自动断行与合流；保存时默认格式化，也可点击编辑器上方“格式化代码”。
- 导出会打开保存位置选择框。有学号时，例如 12345678_Lab 2-1.c；没有题号时使用空项目，没有学号时省略前缀。C++ 使用 .cpp。
- 班号、姓名和学号仅在设置页填写，可留空。
- 题目 JSON 保存标准 I/O、时限和比较规则。测试点显示状态和耗时，无部分分。
- 原样显示编译诊断及 CE、TLE、OLE、RE、WA、AC；不推断错误原因。
- 默认内置 Zig 0.17.0，也可指定 GCC、Clang 或 Zig。路径支持浏览、定位和直接输入，不存在的路径会显示红字并拒绝保存。
- 原创代码采用 MIT。CP Editor 仅为交互与设计参考，未引入其代码或素材。

## 使用和保存

从 [dev Releases](https://github.com/XePWang/labpad/releases) 下载对应平台包，完整解压后启动 LabPad，保留随包工具链与资源文件。支持 Windows x64、Linux x64、macOS arm64。

默认数据目录是程序旁的 labpad/：

~~~text
labpad/
├─ config.json
├─ 空项目.c                  # 保存未分配题号的 C 源码时生成
├─ 空项目.json               # 对应的测试点和规则
└─ projects/
   └─ Lab 2/
      ├─ Lab 2-1.c
      └─ Lab 2-1.json
~~~

设置立即保存。源码和手工编辑的测试点按所选保存方式写入；运行与导出使用当前编辑内容。打开外部源码后，“保存”更新原文件，测试点仍放在数据目录中。手动模式下，切题、打开其他源码或关闭窗口前会提示处理未保存的修改。

设置页可修改数据位置：选择已存在、可写的目录，或输入完整路径。迁移时复制现有资料，保留原目录；为避免覆盖，目标目录已有 LabPad 数据时会拒绝迁移。程序原默认目录中的 location.json 记录新位置，以便重启恢复。

导入 .in/.out（或 .ans）时，一起选择完整的同名文件对；也可导入题目 JSON。导入的 I/O 会保存副本，源码仍按保存方式控制。点击“题目文件”定位规则文件，外部修改后点击“重新加载”；打开的外部源码也会从原路径重新读取。

调试页支持连续输入、实时输出、发送 EOF 和手动停止；切换“输出 / 调试”不会中断程序。

## 编辑器

设置页“编辑与保存”可以选择缩进宽度（1、2、4，默认 4）、亮色 / 暗色主题，以及保存时是否自动格式化（默认开）。空格点仅用于显示，源码和导出文件中仍然是英文空格。

Tab / Shift+Tab 使用 CodeMirror 的原生行缩进；选中多行时作为整体缩进。Enter 使用 C/C++ 语言扩展的上下文缩进，处理大括号、嵌套块和函数参数对齐。格式化使用 clang-format 23.1.1 的 LLVM 风格、80 列目标宽度和所选缩进，使用空格代替 Tab；字符串、宏等由 clang-format 按 C/C++ 语法处理。

| 快捷键（Windows / Linux） | 操作 |
| --- | --- |
| Ctrl+S | 保存；按设置自动格式化 |
| Shift+Alt+F | 格式化代码 |
| Tab / Shift+Tab | 增加 / 减少缩进 |
| Ctrl+Z | 撤销 |
| Ctrl+Y / Ctrl+Shift+Z | 重做 |
| Ctrl+A / C / X / V | 全选 / 复制 / 剪切 / 粘贴 |
| Ctrl+F / Ctrl+H | 查找 / 查找替换 |
| Ctrl+/ | 切换行注释 |
| Alt+↑ / ↓ | 上移 / 下移行 |
| Shift+Alt+↑ / ↓ | 向上 / 向下复制行 |
| Esc，然后 Tab | 将键盘焦点移出编辑器 |

每次格式化、整块缩进和查找替换都可整次撤销。切换源码会隔离编辑历史，防止在新文件中撤销出上一文件的内容。格式化与保存完成时会检查编辑版本；期间继续输入的内容会保留。原文件采用原子替换写入，格式化引擎异常时保存原文并提示原因。

## 编译缓存

Zig 使用自身默认的并行调度。单文件编译不使用构建系统的 -j 参数。dev.2 起，公共运行库缓存保留在系统临时目录的 labpad-compiler-cache-* 中，供后续运行和重启复用；清理后可重新生成。每次任务的程序和工作目录仍在停止或退出后清理。

Linux 实测：HelloWorld 冷缓存编译约 4.36 秒，新建会话并复用缓存后约 91 毫秒。首次构建运行库仍需时间，实际耗时取决于机器、工具链和参数。

## 题目格式

~~~json
{
  "schemaVersion": 1,
  "labId": "Lab 2",
  "problemId": "Lab 2-1",
  "title": "求和",
  "timeLimitMs": 1000,
  "outputLimitBytes": 65536,
  "comparison": { "type": "wcmp" },
  "testCases": [
    { "id": "1", "input": "1 2\n", "expectedOutput": "3\n" }
  ]
}
~~~

wcmp 按空白分隔的 token 比较，保留数值字面量和提示语；3.0 与 3.00 不同。未分配项目/题号的编辑区使用空字符串作为标识。

需要浮点容差时，修改题目文件中的 comparison：

~~~json
{
  "type": "floatTokens",
  "absoluteTolerance": 0.000001,
  "relativeTolerance": 0.000001
}
~~~

对标准 e、实际 a，满足 |a-e| ≤ A **或** |a-e| ≤ R×|e| 就通过该数值。可只设置一项；非数值 token 逐项精确匹配，不剥离提示语或提取其中的数字。

## 开发与验证

开发与 Git 操作在 HPC-wxl 的 /home/user/Projects/labpad 进行。源码位于 pad/，构建、打包及开发临时输出位于 .work/。开发需要 Node.js 24、npm 和 C/C++ 原生构建工具，学生使用发布包无需安装这些开发依赖。

~~~sh
cd pad
npm ci
npm run native
npm run tools -- linux-x64
npm run build
npm test
xvfb-run -a npm run test:ui
npm run dev
~~~

工具链目标为 linux-x64、win-x64、mac-arm64，npm run tools 可接受多个目标。打包可使用：

~~~sh
npm run package -- --linux --x64
npm run package -- --win --x64
npm run package -- --mac --arm64
~~~

跨平台打包需准备对应 Electron 分发文件，并通过 electron-builder 的 electronDist 配置指定。macOS dev 包使用 ad-hoc 签名；Linux 交叉打包时将 LABPAD_RCODESIGN 指向 rcodesign。当前未做 Apple 公证。

npm test 是 Linux 核心集成测试，包含真实 Zig、Checker、WASM 格式化和原文件写入失败检查，运行前先构建格式化 worker。npm run test:ui 覆盖项目选择、保存方式、原文件写回、调试、路径校验和数据迁移，以及编辑器真实快捷键、缩进、查找替换、原子撤销、两种主题和格式化/保存并发。设置 LABPAD_TEST_EXECUTABLE 可测试实际发布包。tests/ui/scenario.cjs 和 editor-scenario.cjs 也可由装有 Playwright 的 Node.js 直接运行，参数为应用路径和截图目录；Windows 编辑器测试会临时备份并恢复剪贴板，Linux 在独立 Xvfb 显示中测试。修改品牌图标后可运行 scripts/create-icons.py 重新生成 PNG/ICO/ICNS（开发时需要 Pillow 和 ImageMagick）。

判题核心位于 pad/core/，独立于 Electron/Vue；后续批量验收可通过命令行复用。第三方声明见 pad/THIRD_PARTY_NOTICES.md；项目的 MIT 不改变组件与工具链各自的许可证。
