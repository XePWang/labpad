# LabPad 维护者技术说明

适用版本：0.1.0-dev.7
撰写日期：2026-10-31
最近核验：2026-10-31；最终验证范围见[验证记录](verification.md)。

## 架构与入口

LabPad 使用 TypeScript、Electron、Vue 3 和 CodeMirror 6。桌面与命令行共用 core 中的编译、进程、判题及比较规则。CP Editor 和 VS Code 用作交互参考；第三方组件按各自许可证使用。

| 位置 | 职责 |
| --- | --- |
| pad/src | Vue 页面、CodeMirror、xterm、导入导出与设置界面 |
| pad/electron | 受控 IPC、文件选择、配置、调试进程及格式化 worker |
| pad/shared | 协议、校验、默认值、快捷键和比较规则 |
| pad/core | 单文件编译、Judge、进程回收、存储、缓存和导出 |
| pad/cli | 点名册、收件、完整版本择优、评分与 CSV |
| examples | 公开课程项目及配置示例 |
| doc/版本号 | 学生、助教、维护者文档及版本对应截图 |
| .work | 构建、工具链、测试记录及临时产物 |

Electron renderer 不具备 Node.js 权限，只通过 preload 暴露的 Bridge 调用主进程。主进程校验请求、窗口来源、文件名及题目协议。操作错误在界面去掉 Electron 包装前缀，C/C++ 编译 stdout/stderr 保持原样。

## 数据与源码版本

默认数据根为程序旁的 labpad。config.json 保存个人设置；location.json 记录用户选择的其他数据根。projects/实验名/ 下保存题目 JSON、各源码版本和 .labpad 元数据；未分配题号的源码位于数据根。

版本由 documentId 与管理路径识别。导入外部源码生成 UTF-8 副本；导入本题同一管理文件激活已有版本。旧外部关联在迁移或保存时采用管理副本，不回写原文件。源码解码支持 UTF-8/BOM、UTF-16 LE/BE 和可往返的 GBK。

每个打开版本保留独立 CodeMirror EditorState、撤销历史及滚动位置，关闭视图后释放其编辑状态。切题最多恢复五份最近编辑源码；完整版本目录仍保留。最近源码恢复落盘内容，不恢复用户已放弃的修改。

保存使用 write-file-atomic。格式化在 worker 中执行；前端用版本/修订号检查返回值，旧格式化结果不能覆盖新输入。格式化应用为一次独立撤销操作。规则与源码分别保存，全部标签关闭时保存规则不能落盘已放弃的源码。

数据迁移复制现有目录，并拒绝覆盖已有数据。项目导入先整批校验，在临时目录生成后重命名；失败时清理临时目录。

## 判题与结果有效性

Compiler 将单文件源码写入独立工作目录，调用所选 C/C++ 工具链；Judge 按测试点逐个执行、关闭 stdin、限制时限和输出字节，区分 CE、TLE、OLE、RE、AC/WA。取消任务保持取消状态。

wcmp 与 floatTokens 使用随包原生 Checker。strictText 在同一 Judge 分支中按明确的文本语义比较，避免 testlib 通用按行读取对尾部空白的隐式处理。CRLF 统一为 LF；默认保留其余空白，两个忽略选项仅处理行末空格/Tab 或文末 LF。

fingerprint 覆盖源码、语言、项目/题号、完整测试、有效比较规则、时限、输出限制、编译器配置及二进制身份。标题更名不改变判断。每份源码保存逐点结果及编译状态；只有同一指纹的全部当前测试点均为 AC，才能显示全题通过。

选择运行范围只影响本次任务，不更改 JSON 中的测试点。一次选点任务编译一次，事件索引保留原数组位置。部分重测替换被选点的旧结果，其他同指纹结果保留。源码或规则改变后旧结果显示需重测。CLI 正式计分始终运行该版本的全部服务器测试。

## 调试、编码与资源

桌面调试沿用 node-pty 与 xterm。Windows 通过 process-host.exe 配置 UTF-8 控制台及 CRT 路径，Linux/macOS 配置 UTF-8 locale。原始输出通过有确认的分批通道送到 xterm，避免持续输出无限堆积。

“>”输入行使用原生文本控件，支持 IME、选区和多行粘贴；Enter 发送，Shift+Enter 换行。提示符仅存在于界面。Ctrl+C 在有选区时复制，无选区时停止进程；EOF 按平台传送。停止 Windows 调试先终止进程树，再释放 PTY 和运行目录。

Zig 启动预热使用可取消任务，实际运行优先。编译缓存位于固定缓存根，使用租约防止与清理并发，默认上限 2 GiB。活动编译期间不清理；运行目录在任务完成和退出时回收。CLI 的编译缓存和运行目录归入实验 build，源码与配置不属于清理对象。

## 界面交互约束

一条标签栏表达打开版本；格式化按钮占固定操作位，以焦点、指针和输入状态显隐。使用短 CSS 过渡，响应 prefers-reduced-motion。键盘聚焦时按钮可见。

测试点整卡、结果徽标及题号菜单共用语义色；亮暗主题分别取色，以文字补充状态。Reka UI 的 Select/Popover/Dialog 提供菜单、结果说明、模态焦点与 Escape 行为。分隔线沿用 splitpanes 的拖动及键盘操作。

导出先冻结所选题号、源码版本和编辑缓冲，再进行预检。两层复选默认全选，父项支持半选；列表包含全部管理版本。每份选中源码独立输出，首份使用原名，其余 _v2、_v3，显示最终文件名并拒绝冲突。前往身份设置时保留选择，返回后以新配置重新预检。写入前使用系统保存对话框，文件替换保持原子性。

## CLI、评分及续测

CLI 使用 SheetJS CE 读取 XLS/XLSX，csv-parse / csv-stringify 处理 CSV，yauzl 读取 ZIP。依赖随 CLI bundle 打包，不增加学生桌面表格依赖。ZIP 按条目依次读取，重复路径仍保留来源序号；限制层数、条目与解压体积，拒绝越界路径和符号链接。只提取 .c/.cpp 作为候选，不运行提交包的脚本或可执行文件。

按学号、labId、problemId 分组，逐份完整编译与测试。相同比例按稳定来源顺序选择；CSV 只列采用版本的客观结果。src/index.json 持久保存已收录的完整源码、来源、SHA-256 和稳定编号。后续收件覆盖同名原包时，历史完整版本仍参与择优；相同来源及内容不会重复收录。索引和源码哈希不一致时保留待核对状态。

评分前先检查编译器身份，并实际编译可信的 C/C++ 探测程序；配置或工具链失败中止任务，不替换原报告。后台刷新桌面测试状态只更新结果，不清除用户尚未关闭的操作错误。

评分使用 BigInt 有理数计算，再按余数分配百分制小数，保证各题显示分数合计为总分，总分加扣分为 100。权重为 0 的题单列完成情况，不影响总分。未知归属、坏包和任务错误保留待核对；已确认满分版本不受无关备选错误影响。

output/state.json 保存配置指纹和采用结果。单人重测先校验配置指纹，从原 summary.csv 保留外部评语，按原名单顺序重新生成。新 output 在暂存目录生成后整体替换；失败回滚，取消保持旧输出。grade.json 的锁阻止同一实验同时写报告。

Linux 批测默认使用 Bubblewrap；每个运行程序只绑定当前用例目录和单独可执行文件，隐藏答案和 Checker 文件在边界外。部署者同时限制编译账号的权限与资源。主机不支持用户命名空间时，批测预检会直接报错。可信自动化夹具显式设置 isolation: none，验证记录中单独说明。

## 构建与测试

开发环境：Node.js 24、npm、C/C++ 原生构建工具。Linux 桌面测试使用 Xvfb。

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

build 先做 TypeScript/Vue 检查，再生成 Electron、renderer、formatter worker、CLI 和第三方声明。临时目录和工具链位于仓库 .work。build:cli 可单独生成命令行 bundle。

~~~sh
npm run tools -- linux-x64 win-x64 mac-arm64
npm run package -- --linux --x64
npm run package -- --win --x64
npm run package -- --mac --arm64
~~~

交叉打包通过 electronDist 指定平台 Electron。macOS dev 包使用 ad-hoc 签名，Linux 主机可用 rcodesign；发布流程检查签名、架构和归档结构，实机运行仍单列。

UI 自动化可设置 LABPAD_TEST_EXECUTABLE 指向实际发布包。测试脚本也可由带 Playwright 的 Node.js 直接运行，参数为应用路径及截图目录。编辑器测试会备份、恢复剪贴板；文件选择和部分确认采用确定性返回值。原生文件对话框另外验证，具体范围写入版本验证记录。

## 发布与文档维护

发布顺序：实现 → 核心及完整流程回归 → 三平台打包 → 成品复测 → 文档截图和验证记录 → README 版本说明 → 提交与 dev 预发布。发布附件为三平台桌面包、CLI 包及 SHA256SUMS.txt，确认文件名、版本及摘要一致。课程项目 JSON 保留在 examples，由课程单独下发。

菜单、快捷键、JSON、CLI、导出命名发生变化时，同步三份指南、README、截图、版本和最近核验日期。首个 stable 在预发布验收后安排。

LabPad 主仓库使用 MIT。Electron、Zig、CodeMirror、LLVM 格式化器、testlib、表格与 ZIP 库按各自许可证分发。详见 pad/THIRD_PARTY_NOTICES.md 及包内 licenses。
