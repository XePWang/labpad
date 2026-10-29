# LabPad

C 语言实验的离线自测桌面工具。**当前只发布 dev 预发布版本。**

左侧编辑单文件源码，右侧运行测试点，底部切换“输出 / 调试”。自测后点击“导出源码”，自动预填学号和题号，例如 12345678_Lab 2-1.c，再选择保存路径。

- 默认内置固定版本 Zig 工具链；允许指定 GCC、Clang 或 Zig。
- 班号、姓名和学号仅在设置页填写。
- 题目 JSON 同时保存标准 I/O、时限和比较规则。每个测试点只有通过或未通过，无部分分。
- 原样显示编译诊断及 CE、TLE、OLE、RE、WA、AC；不推断错误原因。
- 调试页可连续输入、实时查看输出、手动停止；切换页签不会中断程序。
- 原创代码采用 MIT。CP Editor 仅作为交互与设计参考，不引入其代码或素材。

## 使用

从 [dev Releases](https://github.com/XePWang/labpad/releases) 下载对应平台包，完整解压后启动 LabPad。不要只移动可执行文件，工具链与运行组件需一同保留。首次启动在设置页填写个人信息。

程序旁的 labpad/ 是持久化数据目录：

~~~text
labpad/
├─ config.json
└─ projects/
   └─ Lab 2/
      ├─ Lab 2-1.c
      └─ Lab 2-1.json
~~~

配置、草稿和导入的 I/O 自动保存。数据目录需可写。框架会话缓存也使用系统临时目录。运行产物使用系统临时目录，停止任务或退出后清理；不自动归档调试日志或历史成绩。

导入 .in/.out（或 .ans）时，应一起选择完整的同名文件对；也可直接导入题目 JSON。点击“题目文件”可定位规则文件，外部修改后点击“重新加载”。

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

wcmp 按空白分隔的 token 比较，保留数值字面量和提示语。3.0 与 3.00 在此模式下不同。

需要浮点容差时，仅修改题目文件中的 comparison：

~~~json
{
  "type": "floatTokens",
  "absoluteTolerance": 0.000001,
  "relativeTolerance": 0.000001
}
~~~

对标准 e、实际 a，满足 |a-e| ≤ A **或** |a-e| ≤ R×|e| 就通过该数值。可只设置一项；不做提示语剥离或数字提取。非数值 token 逐项精确匹配。

## 开发与验证

开发及 Git 操作在 HPC-wxl 的 /home/user/Projects/labpad 进行。源码位于 pad/，构建、打包和开发临时输出位于 .work/。需要 Node.js 24、npm 和 C/C++ 原生构建工具；开发依赖不会成为学生的额外安装要求。

~~~sh
cd pad
npm ci
npm run native
npm run tools -- linux-x64
npm test
npm run build
npm run dev
~~~

其他分发目标为 win-x64、mac-arm64。npm run tools 可接受多个目标参数。开发原生终端组件需平台构建工具；发布包直接包含构建结果。

在目标平台运行 npm run package 可打包当前平台；也可显式使用 npm run package -- --win --x64、npm run package -- --linux --x64 或 npm run package -- --mac --arm64。跨平台打包前需准备对应 Electron 分发文件并通过 electron-builder 的 electronDist 配置指定。macOS dev 包采用 ad-hoc 签名；在 Linux 交叉打包时，需将 LABPAD_RCODESIGN 指向 rcodesign。当前未做 Apple 公证。

判题核心位于 pad/core/，不依赖 Electron 或 Vue。后续批量验收可以添加命令行入口复用它；当前不实现班级扫描、重复提交选择或成绩导出。

相关声明见 pad/THIRD_PARTY_NOTICES.md。项目的 MIT 不会改变第三方组件与工具链各自的许可证。
