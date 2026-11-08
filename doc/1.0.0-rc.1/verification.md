# LabPad RC.1 验证记录

面向版本：1.0.0-rc.1。核验日期：2026-11-09。源码位置、触发路径与修复见 [最终源码审查](audit-report.md)。

## 结果

| 范围 | 结果与实际检查 |
| --- | --- |
| 类型检查、桌面和 CLI 构建 | 通过 |
| 核心回归 | 190/190，零跳过；覆盖文件回滚、有界读取、清理隔离、报告替换、比较器、构建、版本、评分及外部对象链接 |
| Linux 原生桌面 | 75/75，一次完整运行通过；英文项目导入、保存、编译、送测与导出另行通过 |
| Windows 原生桌面 | 73/73，一次完整运行通过；英文项目全流程及三次 C++ 保存定向复测通过 |
| 独立 GCC/Clang | 四套真实工具链各 16 组通过，共 64 组；Windows/Linux 各有 GCC 和 Clang，见 [兼容性报告](compiler-compatibility.md) |
| CLI 真实归档 | 7/7；使用当前归档内程序、GCC 与 Bubblewrap，覆盖 C/C++、项目二进制资源、名单顺序、隐藏测试、完整最高分版本与历史恢复 |
| macOS arm64 | 交叉构建与静态核验通过：29 个 Mach-O 签名代码页、4,479 个封存资源、8 个嵌套包；实际装载组件为 arm64。没有实机运行验证 |
| 候选归档 | Windows ZIP、Linux tar.gz、macOS ZIP、Linux CLI tar.gz；核对 SHA256、ZIP CRC、符号链接及可执行权限 |

上表采用当前发布包的一次完整运行及归档复验结果。补全、主题、字体和中英切换的定向检查包含在桌面回归中，不重复累加。较早的失败日志、受控延迟记录及测试夹具调整记录继续保留；新增核验见 [双语与紧凑布局核验](localization-verification.md)。

## 界面与交互

- 文件区、编辑区、测试点/调试区、输出/终端标题栏均为 40 CSS px。
- 简体中文 / English 即时切换及重启持久化；取消设置恢复语言，查询、选区、撤销、源码、已有结果和快捷键草稿保留。搜索替换、原生菜单、快捷键窗口及操作错误随语言更新。
- 小窗口隐藏应用内品牌栏，工具栏固定单行，项目/题号、编译、停止和保存保持可达；中英、亮暗主题与全部 16 档缩放均回归。
- 在真实设置页面切换主题，逐帧核对两个缓存标签的内容、撤销状态与配色。
- 窄右区保留收起和运行入口；次级操作进入“更多”。浮层挂载到窗口层，可跨出分区，按窗口边界避让；短窗口内限高滚动，键盘可到达最后一项。
- 100% 缩放覆盖 640×380、640×480、683×380、683×480 及包含系统边框的实际小窗口；题集/项目、亮暗主题、分隔线、文件与标签菜单、补全、查找替换、撤销和格式化均实测。
- 编辑区保留 240 px，文件区至少 150 px 且受可用空间限制。打开查找替换时保留代码行，较矮窗口由页面滚动承接。
- 菜单关闭后立即编辑保持新焦点；仅按 Esc 关闭菜单时，恢复原触发按钮的键盘焦点。
- 编译、调试启动、终端 lpmake 和项目导入的 LPMake 诊断统一进入“输出”。实际结构见 [错误输出示例](diagnostic-examples.md)。
- 保存失败恢复、辅助文件目标、终端上下文、过时栈帧、补全排序/语法场景、字体、缓存、导入导出均纳入原生回归。

## 可重复入口与证据

在 pad 目录使用 npm test、npm run build。桌面流程使用仓库 Playwright 配置与实际打包应用；独立编译器矩阵由 LABPAD_TEST_TOOLCHAINS 指定路径。Windows 与 Linux 分别在本机原生环境运行。

首轮工作目录 .work/rc1-final-audit 保留：

- current-core.log、current-build.log、current-tool-typecheck.log：核心、构建及最终类型检查。
- current-full-linux.log、current-full-windows.log：本次完整桌面运行。
- current-rendered-toolchains-linux.log、current-toolchains-windows.log、toolchain-*.json：四套独立编译器及每组检查清单。
- file-baseline.log、file-fixed.log、io-baseline.log、io-cleanup-fixed.log、output-baseline.log：文件和 I/O 故障注入证据。
- read-pipeline-baseline.log、pipeline-targeted.log：IPC 实际读取次数及定向回归。
- new-baselines.log、new-expanded.log、rc1-complete-linux.log、focus-fixed-windows.log：紧凑窗口、查找面板与菜单焦点的基线及修复记录。
- windows-toolchain-*.json、windows-clang-reset.json：原始工具链安装路径、中文诊断与 Clang 参数命令对照。
- cli-smoke-current/verification.json：首轮 CLI 归档的七组验证。
- mac-validation.json、mac-architecture.json、candidate-manifest.json：首轮签名、资源、装载架构及归档校验。

本轮 .work/rc1-localization 保留：

- release-core.log、release-core.result：190 项核心测试。
- release-clean-full-linux.log、release-clean-windows-full.log：当前发布包完整原生桌面回归。
- release-english-workflow-linux.log、release-english-workflow-windows.log：英文项目端到端流程。
- release-toolchains-linux.log、release-toolchains-windows.log：四套 GCC/Clang 的当前发布包复验。
- m3-layer-verified-evidence：中英、主题、640 px 紧凑布局与模态层级截图及探针。
- save-diagnostic.log、save-workflow-findings.md：C++ 保存重复测试与受控判题响应延迟记录。
- cli-smoke/verification.json：当前 CLI 归档的七组检查。
- release-mac-static.log、release-mac-architecture.json：当前 macOS 包的签名、资源及装载架构。
- release-build-identity.json、candidate-manifest.json：应用内容身份及发布归档 SHA256。
- windows-closeout.json：Windows 验证汇总。

发布附件提供 SHA256SUMS.txt，公开下载后按完整文件 SHA256 复核。macOS 的启动、窗口、终端、调试及自定义编译器仍需实机核验。
