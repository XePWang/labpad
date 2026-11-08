# LabPad RC.1 验证记录

面向版本：1.0.0-rc.1。核验日期：2026-11-09。源码位置、触发路径与修复见 [最终源码审查](audit-report.md)。

## 结果

| 范围 | 结果与实际检查 |
| --- | --- |
| 类型检查、桌面和 CLI 构建 | 通过 |
| 核心回归 | 187/187，零跳过；覆盖文件回滚、有界读取、清理隔离、报告替换、比较器、构建、版本、评分及外部对象链接 |
| Linux 原生桌面 | 65/65，一次完整运行通过 |
| Windows 原生桌面 | 63/63，一次完整运行通过 |
| 独立 GCC/Clang | 四套真实工具链各 16 组通过，共 64 组；Windows/Linux 各有 GCC 和 Clang，见 [兼容性报告](compiler-compatibility.md) |
| CLI 真实归档 | 7/7；使用当前归档内程序、GCC 与 Bubblewrap，覆盖 C/C++、项目二进制资源、名单顺序、隐藏测试、完整最高分版本与历史恢复 |
| macOS arm64 | 交叉构建与静态核验通过：29 个 Mach-O 签名代码页、4,479 个封存资源、8 个嵌套包；实际装载组件为 arm64。没有实机运行验证 |
| 候选归档 | Windows ZIP、Linux tar.gz、macOS ZIP、Linux CLI tar.gz；核对 SHA256、ZIP CRC、符号链接及可执行权限 |

较早运行中的菜单定位失败、焦点竞态及测试夹具调整记录继续保留。上表采用修复后的完整运行和当前归档复验结果。

## 界面与交互

- 文件区、编辑区、测试点/调试区、输出/终端标题栏均为 40 CSS px。
- 在真实设置页面切换主题，逐帧核对两个缓存标签的内容、撤销状态与配色。
- 窄右区保留收起和运行入口；次级操作进入“更多”。浮层挂载到窗口层，可跨出分区，按窗口边界避让；短窗口内限高滚动，键盘可到达最后一项。
- 100% 缩放覆盖 640×380、640×480、683×380、683×480 及包含系统边框的实际小窗口；题集/项目、亮暗主题、分隔线、文件与标签菜单、补全、查找替换、撤销和格式化均实测。
- 编辑区保留 240 px，文件区至少 150 px 且受可用空间限制。打开查找替换时保留代码行，较矮窗口由页面滚动承接。
- 菜单关闭后立即编辑保持新焦点；仅按 Esc 关闭菜单时，恢复原触发按钮的键盘焦点。
- 编译、调试启动、终端 lpmake 和项目导入的 LPMake 诊断统一进入“输出”。实际结构见 [错误输出示例](diagnostic-examples.md)。
- 保存失败恢复、辅助文件目标、终端上下文、过时栈帧、补全排序/语法场景、字体、缓存、导入导出均纳入原生回归。

## 可重复入口与证据

在 pad 目录使用 npm test、npm run build。桌面流程使用仓库 Playwright 配置与实际打包应用；独立编译器矩阵由 LABPAD_TEST_TOOLCHAINS 指定路径。Windows 与 Linux 分别在本机原生环境运行。

工作目录 .work/rc1-final-audit 保留：

- current-core.log、current-build.log、current-tool-typecheck.log：核心、构建及最终类型检查。
- current-full-linux.log、current-full-windows.log：本次完整桌面运行。
- current-rendered-toolchains-linux.log、current-toolchains-windows.log、toolchain-*.json：四套独立编译器及每组检查清单。
- file-baseline.log、file-fixed.log、io-baseline.log、io-cleanup-fixed.log、output-baseline.log：文件和 I/O 故障注入证据。
- read-pipeline-baseline.log、pipeline-targeted.log：IPC 实际读取次数及定向回归。
- new-baselines.log、new-expanded.log、rc1-complete-linux.log、focus-fixed-windows.log：紧凑窗口、查找面板与菜单焦点的基线及修复记录。
- windows-toolchain-*.json、windows-clang-reset.json：原始工具链安装路径、中文诊断与 Clang 参数命令对照。
- cli-smoke-current/verification.json：当前 CLI 归档的七组验证。
- mac-validation.json、mac-architecture.json、candidate-manifest.json：当前签名、资源、装载架构及归档校验。

Git 推送和发布传输保持暂停。macOS 的启动、窗口、终端、调试及自定义编译器仍需实机核验。
