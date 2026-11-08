# LabPad 技术说明

适用版本：1.0.0-rc.1（发布候选）

撰写日期：2026-11-01

更新日期：2026-11-09

## 1. 模块与项目模型
桌面采用 Electron、Vue 3、TypeScript、CodeMirror 6。CLI 与桌面共用 core/compiler、core/build、core/judge 和 Checker。

| 位置 | 职责 |
| --- | --- |
| pad/shared | v1/v2 项目、测试补丁、LPMake 语法/CST、构建类型及校验 |
| pad/core/storage.ts | 题集、单文件版本、配置及原子写入 |
| pad/core/workspace.ts | 多文件工作区、路径与文件操作 |
| pad/shared/parameters.ts | 参数 token 边界、有限硬拦截、覆盖摘要及编译/链接建议 |
| pad/core/build/plan.ts | 基于文件清单的共用构建计划、生效参数分层和有效配置签名 |
| pad/core/build | 快照、文件系统校验、有界并行编译及一次链接 |
| pad/core/compiled-program.ts | 桌面当前编译产物、替换与回收 |
| pad/shared/terminal-history.ts / terminal-keymap.ts | 会话输入限额与平台键位 |
| pad/core/judge.ts | 测试运行、输出限制与比较 |
| pad/core/submission.ts | 指纹、覆盖状态、导出选择和提交包 |
| pad/core/project-archive.ts | ZIP 校验和配置重建 |
| pad/electron | IPC、文件对话框、调试 PTY、预热和退出回收 |
| pad/src | 编辑器、项目选择、文件树、构建表单和测试 UI |
| pad/cli | 收件、名单、完整版本保留、批测与 CSV |

题集继续使用 dev7 的单文件多版本模型；多文件项目以 labId 对应一份工作区，没有可编辑的 problemId 或源码版本层。CLI 对其使用内部评分目标 main，与 GUI 的题号概念分开。

## 2. LPMake 与内部协议
完整语言参考见 [LPMake 使用手册](lpmake-guide.md)。
唯一可编辑构建来源为 LPMake。Lezer 语法生成的解析器供后端和 CodeMirror 共用；命令语义转换成 BuildSpec，再展开为 ResolvedBuildPlan。内部对象可以序列化 JSON，不另设与文本竞争的用户配置。

语法支持 #、Lua 行/块注释、单双引号、跨行、尾随逗号及可选分号。14 个主命令和 4 个兼容声明的参数数目、语言槽和重复规则集中校验，错误保留行列。生成的 lpmake-parser.ts 与 grammar 一并提交；修改语法后运行 npm run parser。

CST 修改按字符串 token、调用和逗号节点定位，保留注释及重复追加调用。表单读取当前缓冲，返回时检查修订号，再通过一次 CodeMirror 事务应用。target 不可恢复成缺省；set_standard 区分 C/C++ 槽；LPMake 不进入 clang-format worker。

路径为工作区内的 / 相对路径，拒绝 ..、绝对路径、设备名、越界链接及大小写/Unicode 等价冲突。文件清单由 tinyglobby 读取，Glob 匹配由 picomatch 统一用于预览与构建，先归一化 Xmake 的 **.c 简写与 | 排除过滤，源码集合去重、排除后按规范化路径排序；包含目录按声明顺序去重，链接库和原始参数保留顺序。

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

语言由扩展名或 set_language 决定，C++ 有效单元触发 C++ 链接驱动。项目参数顺序为：项目标准 → 模式 → 优化覆盖 → 包含目录/宏 → 项目原始参数 → 程序安排的语言、源码和输出。debug 为 -g -O0 -UNDEBUG，release 为 -O2 -DNDEBUG。

## 4. 快照、运行与缓存生命周期
保存状态按实际构建快照中的文本和二进制资源核对。题集规则 JSON 与已识别的构建产物不属于构建输入；打开这些标签不产生未保存误判。GBK、UTF-8 BOM 与 UTF-16 文本通过同一编码函数生成保存字节及未保存资源快照，保存失败沿用原文件/元数据回滚。

桌面构建只采用落盘源码、头文件、资源及 LPMake。当前相关缓冲未保存时，先提示保存并编译，保存失败或取消均不编译。解析、Glob 和构建使用同一份已保存快照；只更新内容变化的文件，删除已经消失的输入。

构建缓存按项目和工具链复用，运行目录独立于可清理缓存。最终程序复制到本次运行目录；可写的运行工作目录与可执行文件分开，避免资源同名覆盖。资源按原字节保存在文本或二进制快照中。每个测试点复制自己的数据副本，不修改项目原件或污染下一测试。

CompilerCache 使用租约保护，超过 2 GiB 时按既有容量策略回收；手动清理也先取得租约。缓存命中不绕过无效 LPMake 或变化的源码。容量测试用较小阈值触发同一分支，不写满真实磁盘。

启动预热为后台工作，实际任务优先。相同缓存目录并不保证所有标准、模式和标准库已经预热。M0 的冷/热数据只说明对应样例；版本验证记录区分预热、首次构建及重复构建。

### 桌面编译与运行

CompiledProgram 在当前进程中只保留一份成功产物。下一次编译先释放旧产物；失败或取消不能重新暴露旧程序。退出及清理缓存时释放最后一份。测试与调试的可写目录单独创建，结束后回收，程序资源每次重新复制。

compilationFingerprint 包含已保存的文件、实际生效参数、工具链身份及单文件版本标识，不含测试点、比较规则和测试时限。送测前重新核对它，避免执行与当前源码不同的程序。验收指纹仍包含完整测试规则，因而修改测试不会沿用旧 AC。

judge 接受可选的已编译程序；桌面复用它，CLI 继续走一次性编译送测。重复运行只创建临时测试目录，不重复编译；部分重测继续只合并同一验收指纹下的结果。

### 终端行编辑

vendor/xterm-readline 固定上游 1.3.1，保留 MIT 许可及修订记录。LabPad 适配会话内 UTF-8 字节限额、输出插入、生命周期及 Unicode 删除；Xterm 使用 Unicode 11 字宽扩展。历史默认 65536 字节，按完整输入淘汰，不使用 localStorage。

程序输出写在待输入行上方，并重定位原有光标；终端尺寸改变仍走 Xterm 与 FitAddon。Linux/macOS 的受控启动命令关闭 PTY 回显，Windows process-host 的 --terminal-no-echo 关闭控制台回显，避免输入显示两遍。原始程序输入不含提示符。

Ctrl+C 的选区复制优先于中断；Mac Command+C 只复制。终端保留 Ctrl+A/E/K/U/L 的行编辑行为，应用层不截获相同前缀；Command+H/Q/M 保留系统行为。主程序与格式化器输出不经过终端行编辑。

### 诊断与弹窗

shared/diagnostics.ts 统计主诊断行，覆盖 GCC、Clang、MSVC 与链接器格式，跳过源码片段和汇总；原文保留。图标以透明背景、主题语义色及短暂淡入显示，减少动画模式禁用提醒动画。

DialogActions 统一应用内确认按钮的 DOM 顺序。原生 messageBox 显式映射返回动作：Windows 主要确认在左、取消在右；GTK 取消在左、确认在右；NSAlert 按系统的尾侧主要动作规则提供数组。危险操作保留取消默认值。测试新弹窗时按按钮含义选择，不依赖平台显示序号。

依据：[Microsoft Dialog controls](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/dialogs-and-flyouts/dialogs)、[GNOME Dialogs](https://developer.gnome.org/hig/patterns/feedback/dialogs.html)、[Apple Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)与[Apple Color](https://developer.apple.com/design/human-interface-guidelines/color)。

## 5. 数据与保存
程序数据默认位于程序旁的 labpad/，可迁移到用户选择的已存在目录。现有 config.json 和题集存储保持兼容。

~~~text
labpad/
├─ config.json
├─ drafts/
│  └─ 空项目.c / 空项目.cpp / 空项目.json / .labpad
└─ projects/
   ├─ 题集/
   │  ├─ Lab 1-1.json
   │  ├─ Lab 1-1.c / Lab 1-1.v2.cpp
   │  └─ .labpad
   └─ 多文件项目/
      ├─ .labpad-project.json
      ├─ LPMake.txt
      ├─ src/
      └─ include/
~~~

题集 .labpad 记录顺序、模板、版本和检查状态；多文件 .labpad-project.json 记录工作区级规则及视图。保存当前/全部更新托管文件，外部导入原件保留。关闭标签与删除文件是两类操作。

单文件用原子写入。多题测试更新先校验所有目标，在临时项目副本完成写入，再交换目录；失败回滚。导入更新不写源码、不替换模板、不重置编辑器撤销栈。

删除项目必须经过明确二次确认，包含文件、测试点、未保存和运行状态。右键目标独立于当前选中项，默认取消；停止相关任务、等待保存后才移除该项目数据。

## 6. 导入、导出和结果有效性
Patch Parsing 与 Normalization 分开。导入时先保留字段存在性，更新完成后再验证完整规则；不能先补默认值再覆盖已有时限或比较方式。

I/O 追加会保留原点及其有效默认规则。新增点采用“点规则 > 文件默认 > 当前默认”，必要时显式写入 comparison；重复 id 改成唯一值并预览。

项目测试集合使用 labpad.projectTests；完整项目使用 labpad.project；单目标使用 labpad.testCases。v1 题集仍可读，v2 通过 mode 区分题集和多文件。

结果指纹包含当前源码、所需头文件/资源或整个工作区文件快照、实际采用的编译/链接参数、实际使用的工具链身份、测试规则及点级 comparison。项目始终不纳入本机参数，题集只纳入所选来源；单语言输入不纳入另一语言的参数和驱动身份。不同编辑标签查看同一多文件工程，不应改变项目结果身份。题集其他已登记源码版本不进入当前版本的指纹；显式包含的源码仍保留，尚未打开的课程模板也按相同规则处理。部分重测只能合并同指纹结果，编译失败和取消不沿用旧 AC。

题集 ZIP 配置只引用本次选中题号和版本；多文件 ZIP 保留目录和 LPMake。实际保存的 ZIP 基名决定包内外层文件夹；内部文件名和目录不受外层改名影响。附带配置控制额外的重建描述，不控制 LPMake 是否导出。读取 ZIP 校验大小、重复项、路径及链接；配置缺少文件明确报错。

## 7. CLI 与完整候选
题集继续按学生、实验、题号保留完整版本；多文件收件以整个目录树为候选，src/index.json 记录稳定序号、来源和哈希。覆盖同名提交不会抹去已经收录的候选。

评分强制使用教师测试。默认锁定教师 LPMake；allowStudentBuild 仅允许受控声明和受限参数，不能加载插件、外部响应文件或改变项目边界。教师修改构建、测试、名单或工具链后，单人续测会拒绝混用旧基线。

summary.csv 和 cases.csv 保持名单顺序，评分闭合至 100 分，保留外部评语。错误收件进入 intake.json；CSV 是后续教学处理的中间文件。

快捷键配置保留既有内部绑定，显示层按 Windows、Linux、macOS 渲染实际按键，并将手工输入转回同一绑定协议；平台显示不改变系统保留键。题集与多文件项目的 templates 分别保留 c/cpp 模板，后续课程包同时提供两项。

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

### LPMake diagnostics
ConfigError 统一生成英文文件/行列、源码与指针；hint、note 独立可选。Spec 的 origin 保存原始文本与声明位置，供解析后的文件解析和 CLI 策略校验定位。显示宽度使用 string-width，覆盖宽字符与 Tab；诊断容器保留等宽排版。

### 默认语言标准
shared/defaults.ts 统一定义 C17 / C++20，编译器配置、LPMake 默认参数和新建模板共用。未设置标准时仍补齐标准；显式 -std / -ansi、LPMake 标准及后置原始参数保留优先级。验收指纹和 CLI 评分上下文使用生效后的默认参数，防止沿用不同语言标准下的旧结果。

### 构建设置与保存状态

ParameterSettings 维护全局与题集参数的独立草稿及当前来源。Config 和题集 buildOptions 通过同一个保存请求进入 Storage.saveSettings 串行队列，两处写入失败时恢复原字节。未配置过的题集第一次自定义时复制当前全局数组，之后保留空数组等明确编辑结果。保存来源决定实际参数，不因打开设置时仍存在旧数组而自动切换。

项目下拉来源锁定为当前项目，表单共享 LPMake.txt 缓冲；未保存状态只取文本。保存普通源码不提交 LPMake。表单校验期间锁定输入，返回时核对修订号，应用作为一次编辑事务。设置和编译器选择弹窗使用 Reka Dialog 管理焦点。

旧项目的 inheritDefaults 仅作为迁移输入读取。true 会将原生效参数和链接顺序固定进 LPMake，并使用 $(projectdir) 表达根路径；false 只移除旧字段。源码布局保持不变。文本与元数据一致写入成功后才完成迁移，失败回滚；旧文本有错时先允许修复，再在保存时完成迁移。新建及导出的项目不再写该字段。旧 CLI 教师配置在读取时同样转成独立文本。

WorkspaceStore.save 使用串行队列和字节回滚，保存回执只推进该次快照基线，新产生的修改继续显示未保存。直接保存源码不会更改其他文件。

Compiler.forDraft 按实际链接驱动及工具链身份缓存目标探测。逻辑 add_links("m") 在 MSVC 目标下由 C 运行库满足，不传 -lm；GNU 目标保持 -lm。显式 add_ldflags("-lm") 原样保留。工具链类型和路径变化仍影响结果身份。

表单校验、直接 LPMake 构建及 CLI 共用有限参数规则。硬拦截只检查用户输入来源，排除 LabPad 自生成的 -x、-c、-o。明确保留 -MD / -MMD 及合法长选项；有歧义的紧连写法交给编译器。预览按参数值边界展示，宏或路径内的 -o 字符不作为新选项。

### 标识与缓存

| 标识 | 输入及用途 |
| --- | --- |
| 评测指纹 | 文件内容及关系、有效参数、工具链、测试点与规则；决定结果是否可沿用 |
| 编译产物身份 | 已保存输入、实际工具链与参数；控制当前桌面程序能否继续运行，不含测试规则 |
| 构建目录键 | 实验范围、实际使用的工具链和构建选项；承载可更新的快照与对象，不因改代码或测试点复制目录 |
| Zig 内部缓存 | 交给 Zig 编译器管理，受 LabPad 容量与租约规则约束 |

参数签名使用稳定逻辑根路径，避免将随机临时位置带入缓存键。目录键按实际使用语言的参数集合计算；新增同类源文件可继续同步原快照。

CLI grade 状态另记录实际使用语言的 compilerContexts。单人续测先核对课程规则、名单和权重，再核对既有结果用过的语言条件；未用语言的默认参数不导致无关失效。新语言可以加入上下文，已使用的条件变化需要全量重测。源码、隐藏测试、教师构建锁定及完整版本择优规则保持原有职责。

参数来源流程验证覆盖 18 组检查，新增编译与内联终端流程覆盖保存、中断、历史、异步输出和关闭标签后构建；最终执行平台、核心测试数量和发布包校验记录见 verification.md。

### 告警与耗时记录

默认警告为 -Wall、-Wextra、-Wshadow、-Wconversion、-Wundef、-Wformat=2，不启用 -Werror。固定 LPMake 模板和新工具链推荐参数共用此列表，旧用户明确保存的参数不自动改写。

2026-11-05 在 Linux 热缓存环境交替执行 10 次编译/链接，取中位数。由 Wall/Wextra 增加上述四项后，GCC 小样例为 43.39 → 42.31 ms，120 函数样例为 121.12 → 121.45 ms；Zig 分别为 53.78 → 56.23 ms、73.15 → 71.72 ms。差异落在本轮运行波动内，不能据此推断告警加速编译。Zig 冷启动标准库准备另计。

## 10. dev9 文件、补全、终端与 DAP

core/files.ts 提供有队列和回滚的文件操作；Storage 同步题集版本、项目打开文件和视图元数据。文件事件带顺序编号，渲染端去重后更新路径，移动缓冲保留标签身份与撤销历史。core/workspace-files.ts 分离 UTF-8 文本和 base64 二进制资源；导出、重建及 CLI 收件保留原字节。

CodeMirror 原生 autocomplete/snippet 提供 UI 和事务；src/editor/completion.ts 增加 Lezer 声明、词法作用域、包含头文件和常用标准库名称来源。Tab/Enter 的薄适配区分方向键确认。复杂 C++ 模板、宏条件与类型推导不等同于完整语义分析。

core/terminal.ts 处理受限命令语法与相对目录；不调用宿主 shell 执行用户命令。文件操作复用 FileService。LPMake 只在 cwd 查固定文件，嵌套配置分别管理。core/artifacts.ts 的 .labpad-build.json 记录命令构建归属；用户已有 build/ 不被直接接管，clean 只删除清单中的文件。

compileDraft 的可选 BuildLocation 仅由 lpmake 命令传入。GUI 编译、自测、断点调试仍保留临时目录 / 受控缓存，不传项目内 build/ 位置。命令构建与 GUI 程序分别维护有效性，失败、取消或源码变化不能暴露旧程序。

core/debug/connection.ts 实现 DAP 字节帧、请求、反向请求与关闭；core/debug/session.ts 调用 CodeLLDB 1.12.3，负责条件断点、暂停、单步、堆栈、变量及只读监视。程序 I/O 通过 PTY，协议通道不混入终端。LLDB 自带 Python 3.12.7；随包默认完整离线，禁用向签名运行时写入 pycache。三平台资源固定 SHA256，准备流程在 scripts/prepare-debugger.mjs。

调试会话绑定保存快照；编辑允许，执行行只在当前文本与快照一致时高亮。结构性修改守卫由主进程统一检查。重启先保存确认、保存成功、停止旧进程、重新编译、启动新进程。取消与保存失败保留旧会话；编译失败不回退旧程序。

xterm-readline 对 prompt 创建、分段输出和重绘做串行协调，保留已提交输入。历史有 UTF-8 字节上限，变量分页与终端 scrollback 有界；停止、退出、异常与关闭均结束所属进程和适配器。

## 11. 分发资源与首次解压

开发使用完整工具链；scripts/stage-toolchain.mjs 只向 staged-toolchains 生成本机资源副本。保留本机 libc、共同头文件、C++ 库与许可证；非本机交叉目标文件不进入发行包。labpad-native.json 用于对不支持的交叉目标给出明确提示，自定义完整 Zig 不受这项资源限制。

beforePack 准备裁剪副本和离线调试器，再由原有签名流程处理 macOS。Windows 桌面继续 ZIP，Linux 桌面和 CLI 保持 tar.gz，macOS 保持 ZIP。减小首次解压成本以减少实际落盘文件为主，不把解包延后到首次启动。

解压测试分别记录归档大小、解包字节、文件数、普通机器数据及受限进程数据。受限档只改变专用解压进程的 CPU 亲和性和配额；I/O 延迟档记录实际延迟。它们是可重复的低性能模拟，不能标为真实低端笔记本实测。各次采用相同容器、辅助程序与限制比较；原生 Windows 资源管理器解压另行记录。

Windows 项目链接生成的 PDB 与程序一并保留，运行副本保持目标文件名；重新构建先移除旧符号，清理按产物归属执行。PTY 与适配器确认退出后释放任务归属，再独立清理运行目录；目录清理失败记录诊断，不保留执行锁。停止进程失败时保留归属及可重试的停止入口。终端命令等待进程收尾，启动包装进程的退出码不作为被调试程序的退出码。

## 字体资源与设置

`shared/typography.ts` 定义中英文字体与字号、默认值及校验。`config.json` 的 `typography` 保存四项设置，旧配置由 Storage 补入默认值。字体设置不参与构建参数和评测指纹。

`src/typography.ts` 使用浏览器 FontFace、unicode-range 与 size-adjust 管理字体。英文默认读取随包 WOFF2，自定义字体使用本地字体源；中文范围单独缩放。CodeMirror 用 Compartment 更新编辑器和补全字体，保留撤销历史；终端使用同一字体源并调整等宽网格、行高和 FitAddon 尺寸。预览关闭及配置替换时释放旧 FontFace。

输出、测试点输入输出和 Diff 使用同一组代码字体 CSS 变量。CSS 行高按字号计算，Xterm 行高按字体测量高度计算；typography 将两者统一到相同的像素行高。字体变更与容器缩放在下一帧合并执行 FitAddon，避免用旧字形尺寸计算行列。Xterm 6 的内部滚动层管理历史回看；旧外层 viewport 隐藏原生滚动条并沿用主题背景，FitAddon 的宿主容器不设置内边距。

JetBrains Mono 固定为 2.304，原字体保存在 `assets/fonts/`，OFL-1.1 原文和下载哈希保存在 `vendor/jetbrains-mono/`。许可证合入发布包 `licenses/THIRD_PARTY_LICENSES.txt`；字体随 Vite 静态资源放入 ASAR。

对应检查为 `tests/typography.test.ts`、`tests/ui/typography.spec.ts` 及 `tests/ui/terminal-layout.spec.ts`，覆盖旧配置、无网络字体加载、独立字号、无效字体、终端中英混合行编辑、撤销历史、重启恢复和字体对象释放。


## 12. 执行上下文与故障恢复

题集请求以 labId、problemId、documentId 显式绑定源码；项目请求绑定工作区。Storage.buildTarget 校验归属、文件存在性和缓冲身份，辅助标签不读取旧的活动版本偏好作为构建目标。导出单份源码使用明确的源码目标；枚举多个导出版本时，各版本按自身 documentId 预检，不继承当前编辑标签的 target。workspaceBootstrap 刷新文件的语言与编码元数据，保留当前未保存文本。

首次创建默认源码时同步写入实际文件。已登记源码在磁盘上缺失时，LoadedDraft.missing 使标签显示未保存；身份匹配的当前缓冲可通过保存恢复文件。没有对应缓冲的缺失目标仍被拒绝，编译仍要求输入已经保存。保存成功后同时清除标签和活动草稿的缺失状态。

shared/file-language.ts 统一源码、头文件、LPMake 识别及编辑语言。set_language 的有效语言同时用于构建与补全，未指定时按扩展名识别。

Storage.operateFiles 与 FileService 是文件事务入口；shared/file-changes.ts 统一路径映射。提交同步持久化视图与断点，再以工作区 scope 广播给标签、缓冲、活动目标和终端。提交后的备份清理失败只返回警告，不回滚已经提交的文件。界面先完成文件读取，再一次发布更新后的文件树与标签。

CommandTerminal 唯一持有 cwd；提示符使用后端校验后的 TerminalContext。作用域由实际工作区根与模式确定，同题集切题沿用真实 cwd；目录移动同步路径，删除或外部移除后退回根目录。旧作用域的迟到事件不更新新工作区。

shared/execution.ts 的任务状态同时派生占用与阶段文字；保存生命周期独立于调试生命周期。保存队尾仅代表队列排空，单次保存失败由该次调用返回。编译预检、评测及调试启动先占用任务；停止使迟到的预检响应失效。后台补全、文件同步和调试定位保留已有操作提示，不能通过通用 action 的起始清空覆盖保存失败信息。

设置内的参数预览在 IPC 前，将项目参数和编译器配置转换为普通数据；不向 Electron 传递 Vue 响应式对象。tests/ui/parameter-preview.spec.ts 覆盖题集的两种参数来源、多文件项目的 LPMake 预览及取消后的配置保留。

编译完成事件重新排队核对当前目标的就绪状态。并发检查可能恰好观察到旧程序已清除、新程序尚未完成；不能让这个瞬时结果一直禁用测试点运行入口。回查仍使用当前目标与修订号，避免将其他实验或终端构建的结果直接作为 GUI 可运行状态。

core/pty-session.ts 共管原始运行与终端程序的输出合并、背压确认和退出。进程停止、逻辑状态释放和磁盘清理分开处理：停止失败可重试；确认退出后，目录删除失败不会让后续编译永久等待。

src/editor/symbols.ts 从明确的声明节点提取名称，当前文件消费 CodeMirror 的增量语法树；头文件按内容缓存声明，并在实际路径下解析 include。缓存限制 64 项、合计 1 Mi 字符，切换工作区清空。匹配、排序、snippet、接受与撤销使用 @codemirror/autocomplete；只通过语境过滤和 boost 表达局部优先，不另写模糊匹配器。

左右折叠保留组件实例，隐藏区域设 inert；动画共用时长、缓动和减少动画设置。主操作使用 action-bg/action-hover，焦点、选中和 AC 保留各自语义色。编辑器状态键包含工作区 scope，避免不同实验的同名文件共享撤销记录。

可重复故障回归见 tests/ui/review-regressions.spec.ts、tests/ui/interface-state.spec.ts 及对应核心测试。平台、执行次数和结果以 verification.md 为准。

## 13. 规则保存与异步响应

普通文档保存只写该文档，规则通过 Storage.saveProblem 单独写入。当前题目 JSON 使用 saveRuleFile 校验结构和 labId/problemId；无题号的共享草稿按当前选择归一化后比较规则基线，再保留用户文本写入；SaveResult.problem 将已保存规则同步到面板。面板和 JSON 同时未保存时拒绝覆盖，两个草稿保留。规则面板保存时刷新干净的 JSON 标签；退出根据 WorkspaceEdits 保存实际修改及规则基线。

切换标签与修改内容分开处理。查看辅助标签保留当前源码目标、编译就绪和评测结果；切换源码目标重新查询对应状态，实际内容变化才进入 changed 状态。保存引起的格式化若改变源码，仍重新核对编译状态。

WorkspaceStore.list 直接使用 FileService.list，统一初始化和刷新时的保留目录排除。保留路径的写入校验继续有效；文件区默认隐藏 .git。构建快照仍按自身规则排除已识别产物，文件区继续显示普通 build 目录。

CLI 历史恢复直接使用 directorySnapshot，同时校验 files 和 binaryFiles；删除文本专用目录包装。完整版本保留稳定 ordinal，二进制资源参与原有哈希及完整版本择优。

终端补全请求记录 generation、scope、cwd、输入修订和请求序号。键盘编辑、光标移动、粘贴、提交和取消都会使旧输入请求失效；主进程核对请求目录，渲染进程在成功及失败回调写入前复核上下文。

NativeDebugger 的 inspectionId 由会话身份和 inspection 计数组成。暂停、继续和换帧使旧检查失效；堆栈、变量、监视在等待后再次核对；当前暂停位置加载作用域失败仍显示诊断，旧帧的失败不会覆盖新状态。变量视图及递归展开保留各自请求轮次，旧成功、错误和 finally 均不更新新视图；卸载时一并失效。

readFileLimited 先用已打开文件的 stat 拒绝超限文件，再分块读取，在原上限加一个哨兵字节处停止；文件增长也不绕过上限。finally 关闭句柄，终端 cat 保持每文件 1 MB 的原有约束。主操作色定义在 themes.css 的公共主题根，ExportDialog 的 Portal 与主界面共用按钮状态规则。

参考实现：[VS Code 目录排除](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/files.contribution.ts)、[补全会话取消](https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/suggest/browser/suggestModel.ts)、[异步树输入失效](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/tree/asyncDataTree.ts)、[有界读取与关闭](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/common/io.ts)、[文本内容与保存版本](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/textfile/common/textFileEditorModel.ts)。采用其处理边界，接入 LabPad 已有的保存队列、FileService、目录快照、DAP 会话及主题。

对应回归：tests/review-persistence.test.ts、tests/rule-save.test.ts、tests/debug-inspection.test.ts、tests/read-file.test.ts，以及 tests/ui/review-persistence.spec.ts、tests/ui/async-context.spec.ts、tests/ui/action-theme.spec.ts。测试中的延迟响应由故障注入触发；真实断点调试另外使用随包调试器执行。

## 14. 读取、Diff 与异步边界

shared/resource-limits.ts 集中定义编辑器 8 MiB、归档及配置入口 100 MiB 上限。core/read-file.ts 复用已打开句柄的 stat 和分块有界读取，文件增长也受限；源码、辅助文件、GUI ZIP 与 CLI 项目收件使用同一入口。目录快照按实际读取字节累计，终端 cat 继续采用原有 1 MiB 约束。

src/editor/output-diff.ts 使用 diff 库的原生预算：词级最多 50 ms / 2048 编辑步，随后按行最多 25 ms / 1024 步；总输入超过 200000 个 UTF-16 代码单元时直接使用双侧预览，每侧最多 50000 个。原文和评测输入保持完整。

core/cleanup.ts 独立执行各释放动作，并以零参数调用回调，避免 Promise.then 传入的值改变第三方回调签名。原始 Error 保留代码及堆栈，附加清理原因；JudgeResult.cleanupWarnings 单独记录评测清理警告。测试点更新失败保留写入错误及原规则，回滚失败保留暂存与备份供恢复。

文件打开、文件区刷新、补全、构建成员预览及栈帧选择校验视图代次和请求序号；A→B→A 不是同一次视图。workspace:files/open 显式携带题号。断点与监视设置加载校验归属，写入捕获原项目和当时数据。设置扫描失效于设置关闭；参数预览在输入变化时立即失效，防抖仅推迟新计算。

弹窗统一使用 DialogActions 和 nativeButtonOrder；新建名称通过 Reka 的 open-auto-focus 聚焦。工具栏动作组在窄窗口换行，极矮视口允许滚动。补全排序、长签名截断及接受行为继续使用 CodeMirror；UI 菜单保留界面字体。故障证据、原生窗口回归与平台范围见 [质量收敛记录](quality-audit.md) 和 [验证记录](verification.md)。

### Windows 原子保存

core/atomic-file.ts 统一承接 write-file-atomic。整次写入含重试按文件排队；仅 Windows 的 rename + EPERM/EACCES/EBUSY 额外重试四次，等待合计 750 ms。其他错误直接返回，持续失败保留原字节并允许后续保存。错误分类参考 [VS Code 文件系统实现](https://github.com/microsoft/vscode/blob/main/src/vs/platform/files/node/diskFileSystemProvider.ts)；回归直接注入真实 fs.rename，而非只模拟 IPC 错误。


## RC.1 故障边界与回归

- 目录快照与 CLI 入口复用 core/read-file.ts，按打开句柄的元数据及实际读取字节执行限制；历史单文件收件继续采用 2 MB 预算。
- FileService 移动来源后立即注册恢复操作。恢复失败时保留事务目录，错误中给出位置，禁止删除唯一备份。
- CLI 释放编译会话和批测锁互相独立；报告事务等待全部暂存写入结束后再处理失败。回滚错误作为附加诊断保留，不能替代原错误。
- 补全快照仅选择头文件与项目的根 LPMake.txt；题集不读取 LPMake 参数。编译状态查询复用同一份已保存快照。
- 标题高度由 --pane-header-height 统一为 40 CSS px。右区按可用宽度收拢低频动作；运行及展开/收起保持可达。菜单使用 Reka Portal、碰撞避让和可用高度变量，不受侧栏 overflow 影响。

复现入口、修改位置、原生窗口证据及发布候选验收见 [最终源码审查](audit-report.md) 和 [验证记录](verification.md)。
