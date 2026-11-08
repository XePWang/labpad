# LabPad RC.1 验证记录

面向版本：1.0.0-rc.1。核验日期：2026-11-09。源码修复与复现路径见 [最终源码审查](audit-report.md)。

## 结果

| 范围 | 结果与实际检查 |
| --- | --- |
| 类型检查、桌面和 CLI 构建 | 通过 |
| 核心回归 | 184/184，零跳过；覆盖文件回滚、有界读取、清理隔离、报告替换、比较器、构建、版本与评分 |
| Linux 原生桌面 | 58 项均完成验证：完整运行 57 项通过；1 项旧夹具仍假设“重新加载”固定在“更多”中，修正为选择实际可见入口后，该完整流程重测通过（14 组操作） |
| Windows 原生桌面 | 56 项均完成验证：完整运行 55 项通过；同一夹具修正后，该完整流程重测通过（14 组操作） |
| CLI 真实归档 | 7/7，使用归档内程序、GCC 与 Bubblewrap；含 C、C++、项目二进制资源、名单顺序、隐藏测试、完整最高分版本和历史恢复 |
| macOS arm64 | 交叉构建与静态检查通过：29 个 Mach-O 签名代码页、4,479 个封存资源、8 个嵌套包；实际装载路径为 arm64。没有实机运行验证 |
| 候选归档 | Windows ZIP、Linux tar.gz、macOS ZIP、Linux CLI tar.gz；检查 SHA256、ZIP CRC、符号链接及可执行权限 |

完整桌面运行中的单项失败属于本轮自适应菜单改变后的夹具定位假设。保留原始失败日志与修正后的重测日志，没有将它记为一次全绿的完整运行。

## 界面与交互

- 文件区、编辑区、测试点/调试区、输出/终端标题栏实测均为 40 CSS px。
- 两端主题逐帧检查均通过；切换后两个缓存标签的内容、撤销状态和配色正常。
- 窄右区保留收起和运行入口；次级操作进入“更多”。浮层挂载到窗口层，允许跨出右区，按窗口边界避让；短窗口内限高滚动，键盘可到达最后一项。
- 源码与辅助文件目标、保存失败恢复、终端上下文、栈帧过时响应、补全排序和语法场景、字体、缓存清理、项目导入导出均纳入原生回归。

## 可重复入口与证据

在 pad 目录使用 `npm test`、`npm run build`，桌面回归使用仓库 Playwright 配置与已打包应用。原生运行分别使用 Linux 显示服务和 Windows 桌面，测试资源均为虚构夹具。

本轮工作目录 `.work/rc1-final-audit/` 保留基线失败、故障注入和实际候选运行证据：

- `rc-core.log`、`rc-build.log`：核心与构建。
- `rc-linux-ui.log`、`desktop-rerun-linux.log`：Linux 完整运行与修正夹具后的完整场景重测。
- `rc-windows-ui.log`、`desktop-rerun-windows.log`：Windows 对应记录。
- `file-baseline.log`、`file-fixed.log`、`io-baseline.log`、`io-cleanup-fixed.log`、`output-baseline.log`：缺陷与修复证据。
- `read-pipeline-baseline.log`、`pipeline-targeted.log`：IPC 实际读取次数与定向回归。
- `header-targeted.log`、`header-hit.log`、`rc1-overflow-menu.png`：标题栏、菜单及几何检查。
- `cli-smoke-recheck/verification.json`：真实 CLI 归档 7 项验证。
- `mac-validation.json`、`mac-architecture.json`、`candidate-manifest.json`：签名、装载架构和候选文件校验。

候选包尚未上传；Git 推送和发布传输按当前安排保持暂停。macOS 的启动、窗口、终端与调试需要实机补验。
