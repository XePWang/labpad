# LabPad 技术说明

适用版本：0.1.0-dev.8（开发预发布）

撰写日期：2026-11-01

## 1. 模块与项目模型
桌面采用 Electron、Vue 3、TypeScript、CodeMirror 6。CLI 与桌面共用 core/compiler、core/build、core/judge 和 Checker。

| 位置 | 职责 |
| --- | --- |
| pad/shared | v1/v2 项目、测试补丁、LPMake 语法/CST、构建类型及校验 |
| pad/core/storage.ts | 题目集、单文件版本、配置及原子写入 |
| pad/core/workspace.ts | 多文件工作区、路径与文件操作 |
| pad/core/build | 快照、Glob、参数解析、有界并行编译及一次链接 |
| pad/core/judge.ts | 测试运行、输出限制与比较 |
| pad/core/submission.ts | 指纹、覆盖状态、导出选择和提交包 |
| pad/core/project-archive.ts | ZIP 校验和配置重建 |
| pad/electron | IPC、文件对话框、调试 PTY、预热和退出回收 |
| pad/src | 编辑器、项目选择、文件树、构建表单和测试 UI |
| pad/cli | 收件、名单、完整版本保留、批测与 CSV |

题目集继续使用 dev7 的单文件多版本模型；多文件项目以 labId 对应一份工作区，没有可编辑的 problemId 或源码版本层。CLI 对其使用内部评分目标 main，与 GUI 的题号概念分开。

## 2. LPMake 与内部协议
完整语言参考见 [LPMake 使用手册](lpmake-guide.md)。
唯一可编辑构建来源为 LPMake。Lezer 语法生成的解析器供后端和 CodeMirror 共用；命令语义转换成 BuildSpec，再展开为 ResolvedBuildPlan。内部对象可以序列化 JSON，不另设与文本竞争的用户配置。

语法支持 # 注释、双引号字符串、跨行及尾随逗号。14 个命令、参数数目、语言槽和重复规则集中校验，错误保留行列。生成的 lpmake-parser.ts 与 grammar 一并提交；修改语法后运行 npm run parser。

CST 修改按字符串 token、调用和逗号节点定位，保留注释及重复追加调用。表单读取当前缓冲，返回时检查修订号，再通过一次 CodeMirror 事务应用。target 不可恢复成缺省；set_standard 区分 C/C++ 槽；LPMake 不进入 clang-format worker。

路径为工作区内的 / 相对路径，拒绝 ..、绝对路径、设备名、越界链接及大小写/Unicode 等价冲突。Glob 使用 tinyglobby，源码集合去重、排除后按规范化路径排序；包含目录按声明顺序去重，链接库和原始参数保留顺序。

## 3. 直接驱动构建管线
~~~text
LPMake.txt
  → BuildSpec / ResolvedBuildPlan
  → 有界并行编译 + 单次链接
  → Zig cc/c++ 或 GCC/G++、Clang/Clang++
  → 同一个 Judge / 交互调试
~~~

Zig 后端直接调用 zig cc / zig c++，通过 Compiler.environment 的受控 ZIG_LOCAL_CACHE_DIR、ZIG_GLOBAL_CACHE_DIR 复用编译器缓存。它沿用启动预热和 CompilerCache；不执行 zig build，不生成 build.zig 或 shared-runner，也不实现跨项目 .d 对象内容寻址仓库。

GCC/Clang 每次全量安排编译单元，不依赖 Zig。并发上限为 min(可用核心数, 8, 单元数)。各单元分别收集 stdout/stderr，再按源顺序拼接，避免错误行交错。工作进程全部结束后释放租约；失败阻断链接，取消回收整棵进程树。

对象映射为 obj/<relative-source-path>.o，保留目录和扩展名。链接只使用本次计划的对象。链接响应文件使用受控相对路径及 ASCII 对象别名，避免 Windows MinGW 对含中文绝对路径的响应文件解释差异。原始对象仍保留可追溯映射。

语言由扩展名或 set_language 决定，C++ 有效单元触发 C++ 链接驱动。参数顺序为：允许继承的本机默认 → 项目标准 → 模式 → 优化覆盖 → 包含目录/宏 → 项目原始参数 → 程序安排的语言、源码和输出。debug 为 -g -O0 -UNDEBUG，release 为 -O2 -DNDEBUG。

## 4. 快照、运行与缓存生命周期
手动保存时，构建输入为落盘文件叠加打开标签的未保存缓冲，包括头文件和 LPMake。解析、Glob 和构建使用同一快照；只更新内容变化的文件，删除已经消失的输入。

构建缓存按项目和工具链复用，运行目录独立于可清理缓存。最终程序复制到本次运行目录；可写的运行工作目录与可执行文件分开，避免资源同名覆盖。首版资源随文本文件快照管理。每个测试点复制自己的数据副本，不修改项目原件或污染下一测试。

CompilerCache 使用租约保护，超过 2 GiB 时按既有容量策略回收；手动清理也先取得租约。缓存命中不绕过无效 LPMake 或变化的源码。容量测试用较小阈值触发同一分支，不写满真实磁盘。

启动预热为后台工作，实际任务优先。相同缓存目录并不保证所有标准、模式和标准库已经预热。M0 的冷/热数据只说明对应样例；版本验证记录区分预热、首次构建及重复构建。

## 5. 数据与保存
程序数据默认位于程序旁的 labpad/，可迁移到用户选择的已存在目录。现有 config.json 和题目集存储保持兼容。

~~~text
labpad/
├─ config.json
├─ 空项目.c / 空项目.cpp / 空项目.json / .labpad
└─ projects/
   ├─ 题目集/
   │  ├─ Lab 1-1.json
   │  ├─ Lab 1-1.c / Lab 1-1.v2.cpp
   │  └─ .labpad
   └─ 多文件项目/
      ├─ .labpad-project.json
      ├─ LPMake.txt
      ├─ src/
      └─ include/
~~~

题目集 .labpad 记录顺序、模板、版本和检查状态；多文件 .labpad-project.json 记录工作区级规则及视图。保存当前/全部更新托管文件，外部导入原件保留。关闭标签与删除文件是两类操作。

单文件用原子写入。多题测试更新先校验所有目标，在临时项目副本完成写入，再交换目录；失败回滚。导入更新不写源码、不替换模板、不重置编辑器撤销栈。

删除项目必须经过明确二次确认，包含文件、测试点、未保存和运行状态。右键目标独立于当前选中项，默认取消；停止相关任务、等待保存后才移除该项目数据。

## 6. 导入、导出和结果有效性
Patch Parsing 与 Normalization 分开。导入时先保留字段存在性，更新完成后再验证完整规则；不能先补默认值再覆盖已有时限或比较方式。

I/O 追加会保留原点及其有效默认规则。新增点采用“点规则 > 文件默认 > 当前默认”，必要时显式写入 comparison；重复 id 改成唯一值并预览。

项目测试集合使用 labpad.projectTests；完整项目使用 labpad.project；单目标使用 labpad.testCases。v1 题目集仍可读，v2 通过 mode 区分题目集和多文件。

结果指纹包含源码或整个工作区快照、继承设置、有效编译配置、实际工具链身份、测试规则及点级 comparison。不同编辑标签查看同一多文件工程，不应改变项目结果身份。部分重测只能合并同指纹结果，编译失败和取消不沿用旧 AC。

题目集 ZIP 配置只引用本次选中题号和版本；多文件 ZIP 保留目录和 LPMake。实际保存的 ZIP 基名决定包内外层文件夹；内部文件名和目录不受外层改名影响。附带配置控制额外的重建描述，不控制 LPMake 是否导出。读取 ZIP 校验大小、重复项、路径及链接；配置缺少文件明确报错。

## 7. CLI 与完整候选
题目集继续按学生、实验、题号保留完整版本；多文件收件以整个目录树为候选，src/index.json 记录稳定序号、来源和哈希。覆盖同名提交不会抹去已经收录的候选。

评分强制使用教师测试。默认锁定教师 LPMake；allowStudentBuild 仅允许受控声明和受限参数，不能加载插件、外部响应文件或改变项目边界。教师修改构建、测试、名单或工具链后，单人续测会拒绝混用旧基线。

summary.csv 和 cases.csv 保持名单顺序，评分闭合至 100 分，保留外部评语。错误收件进入 intake.json；CSV 是后续教学处理的中间文件。

快捷键配置保留既有内部绑定，显示层按 Windows、Linux、macOS 渲染实际按键，并将手工输入转回同一绑定协议；平台显示不改变系统保留键。题目集与多文件项目的 templates 分别保留 c/cpp 模板，后续课程包同时提供两项。

## 8. 构建和验证
开发环境使用 Node.js 24，运行 CLI 需要 Node.js 22+：

~~~sh
cd pad
npm ci
npm run native
npm run tools -- linux-x64
npm run build
npm test
xvfb-run -a npm run test:ui
npm run cli -- --help
~~~

build 生成桌面主进程、preload、格式化 worker、前端及 CLI。tinyglobby 在 Node CJS 包中使用其 CJS 入口，避免上游 ESM 入口的 import.meta.url 在 CJS 打包后丢失。

三平台工具链和打包产物保存在 .work。Windows、Linux 实际运行证据与 macOS 交叉构建/签名检查分开报告。最终包应重复运行源码管理、快捷键、I/O、调试、分栏、测试点更新、ZIP 重建与完整项目批测。

## 9. 发布与文档维护
dev 版本使用 GitHub Pre-release。附件只含 Windows x64、Linux x64、macOS arm64、Linux CLI 程序包与 SHA256SUMS.txt；课程项目 JSON 放在 examples，由课程另行下发。

上传后核对服务端资源大小、SHA256 和公开下载。不要把“编译成功”写成目标平台实际运行通过。

变更菜单、快捷键、JSON、CLI 或导出行为时，同步 README 和对应版本学生、助教、维护者指南。大版本更新建立新的 doc/<版本>/，更新日期、截图和验证记录；旧版文档保留。第三方依赖保留许可证声明。
