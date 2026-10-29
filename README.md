# LabPad

C 语言实验的离线自测桌面工具。当前只发布 **dev 预发布版本**。

左侧编辑单文件源码，右侧查看测试点，底部切换“输出 / 调试”。没有测试点时，点击“编译并运行”：编译成功后进入可交互输入的调试页，编译失败时显示原始输出。

- 实验项目和题号通过下拉菜单选择；菜单内可新建，导入题目 JSON 也会加入项目列表。未分配时显示 <无>。
- 默认手动保存，支持 Ctrl+S；设置页可切换自动保存。打开已有源码后，保存直接写回原文件。
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
npm test
npm run build
npm run dev
~~~

工具链目标为 linux-x64、win-x64、mac-arm64，npm run tools 可接受多个目标。打包可使用：

~~~sh
npm run package -- --linux --x64
npm run package -- --win --x64
npm run package -- --mac --arm64
~~~

跨平台打包需准备对应 Electron 分发文件，并通过 electron-builder 的 electronDist 配置指定。macOS dev 包使用 ad-hoc 签名；Linux 交叉打包时将 LABPAD_RCODESIGN 指向 rcodesign。当前未做 Apple 公证。

npm test 是 Linux 核心集成测试。npm run test:ui 覆盖项目选择、保存方式、原文件写回、调试、路径校验和数据迁移。设置 LABPAD_TEST_EXECUTABLE 可测试实际发布包。tests/ui/scenario.cjs 也可由装有 Playwright 的 Node.js 直接运行，参数为应用路径和截图目录。修改品牌图标后可运行 scripts/create-icons.py 重新生成 PNG/ICO/ICNS（开发时需要 Pillow 和 ImageMagick）。

判题核心位于 pad/core/，独立于 Electron/Vue；后续批量验收可通过命令行复用。第三方声明见 pad/THIRD_PARTY_NOTICES.md；项目的 MIT 不改变组件与工具链各自的许可证。
