# LabPad RC.1 最终源码审查

审查日期：2026-11-09。基线：8a7861f。范围为当前题集、项目及其学生自测、导出收件、助教批测业务；不新增构建后端或补全语义能力。

## 结论与证据范围

本轮确认十二项问题和标题栏排布问题，按文件事务、输入读取/报告清理、重复读取、界面四组处理。单项结论来自下列真实实现及隔离故障探针；测试与平台汇总见 [验证记录](verification.md)。macOS 没有实机。

## R1 · 文件移动双重失败会删除唯一源码 · P1

- 基线位置：`pad/core/files.ts:267`。修复位置：`pad/core/files.ts:269`。
- 触发：将 main.c 移至 nested/main.c；来源已经进入事务目录，目标 rename 报 EPERM，随后恢复原位也报 EPERM。
- 原因：恢复操作尚未加入 undo；恢复抛错后外层仍删除事务目录。基线探针验证原位与备份均不存在。
- 修复：首次移动后立即登记恢复，跟踪源码当前所在位置；恢复失败保留备份，并在提示中指出目录。
- 复现/回归：`npx tsx --test tests/rc1-file-rollback.test.ts`；同时跑 files 与 file-reconciliation 回归。真实文件字节参与断言。

## R2 · 目录快照只相信早先的文件大小 · P2

- 基线位置：`pad/core/workspace-files.ts:101`。修复位置：`pad/core/workspace-files.ts:100`。
- 触发：文件在 lstat 与 readFile 之间增长；单文件或总量统计仍使用旧 size。
- 证据：夹具将路径元数据固定为旧值，实际文件为 8,388,609 字节。基线读取并接受，修复后拒绝。已有读取底座另测打开后继续增长、哨兵字节与句柄关闭。
- 修复：复用有界读取，按实际字节累计项目预算，不再全量 readFile。
- 复现/回归：`tests/rc1-boundaries.test.ts` 第一项及 `tests/read-file.test.ts`。

## R3 · CLI 单次送测与历史源码读入遗漏限制 · P2

- 基线位置：`pad/cli/main.ts:47`、`pad/cli/main.ts:56`、`pad/cli/versions.ts:64`。
- 修复位置：`pad/cli/main.ts:87`、`pad/cli/versions.ts:64`。
- 触发：`labpad judge --source large.c --tests tests.json` 或 `--project large.zip`；文件大小超过入口预算。
- 证据：对上一轮真实 CLI 归档分别传入 8 MB+1 的源码与 100 MB+1 的 ZIP，在 readFile 即将分配前拦截，两个入口都到达未限量读取。没有在日常进程中制造内存耗尽。
- 修复：单次入口调用同一有界读取底座；历史单文件版本恢复沿用批量收件的 2 MB 限制，失败仍进入待核对。
- 回归：`tests/rc1-boundaries.test.ts` 第二项。GUI、CLI 收件、单次送测和历史读取路径均静态对照。

## R4 · 批测清理失败盖住原错误并跳过解锁 · P2

- 基线位置：`pad/cli/grade.ts`；单次送测也有相同清理出口。
- 修复位置：`pad/cli/grade.ts:725`、`pad/cli/main.ts:165`。
- 触发：编译器诊断失败后，dispose 再报 EBUSY。原实现返回清理错误，release 未执行。
- 证据：隔离运行同一批测入口，注入 dispose 失败，核对原错误文本及 proper-lockfile 的真实锁状态；修复后原诊断保留并附清理信息，锁可再次取得。
- 修复：会话、锁、自检目录独立清理。成功报告不因备份删除失败被报告为评测失败。
- 回归：`tests/rc1-boundaries.test.ts` 第三项，完整批测和补交回归。

## R5 · 报告发布回滚会丢掉原始诊断和新报告 · P2

- 基线位置：`pad/cli/grade.ts`。修复位置：`pad/cli/grade.ts:346`。
- 触发：output 已移入旧备份，暂存目录发布失败，再恢复旧 output 也失败。
- 证据：基线函数注入发布 ENOSPC、恢复 EBUSY 后只返回 EBUSY，新暂存报告被删除，旧备份仍在。另一个用例验证提交成功后仅备份清理失败。
- 修复：等待所有暂存写入完成；双失败时保留两份报告并给出位置，原 ENOSPC 继续是主错误。已提交报告的清理问题仅返回提醒。
- 回归：`npx tsx --test tests/rc1-report-output.test.ts`，同时核对原评语保留。

## R6 · 补全与编译状态进行多余的整项目读取 · P2

- 位置：`pad/electron/main.ts:1319`、`pad/electron/main.ts:2253`。
- 触发：项目内含 8 MB 运行数据，打开编辑器或刷新编译状态。
- 证据：用 AsyncLocalStorage 按真实 IPC 请求统计打开次数；基线补全读取无关数据一次，编译状态读取两次；修复后为 0 次和 1 次。
- 修复：快照支持按文件筛选；补全只读头文件与项目根 LPMake，题集不读取 LPMake 参数。编译状态复用已保存输入。构建/评测的完整资源快照保持不变。
- 回归：`tests/ui/rc1-read-pipeline.spec.ts`。终端 cat 夹具改为按 terminal:command 归属计数，原 0 字节拒绝、1 MB+1 哨兵及句柄关闭断言均保留。

## R7 · 大比例缩放时分区高度被挤成个位数 · P2

- 位置：`pad/src/themes.css` 的 work-layout / splitpanes 最小高度与 app-shell 滚动规则。
- 触发：1280 像素窗口使用 400% 缩放。原工作区只剩 16.5 CSS px，上部编辑与测试点区域只剩 8.28 px；40 px 标题栏被父级裁剪，控件无法命中。
- 修复：为工作区和上下两部分设置基本内容高度，空间不足时由应用纵向滚动承接；不让固定高度标题栏挤压成不可点击区域。
- 回归：`tests/ui/rc1-toolbar.spec.ts`，原生窗口内用元素命中测试及实际浮层边界检查，保留失败截图与几何记录。

## R8 · 文件区可把编辑区挤成零宽 · P2

- 位置：`pad/src/components/FileTree.vue:753`、`pad/src/themes.css:348`；窗口下限为 `pad/electron/main.ts:2519`。
- 触发：100% 缩放、640 × 380 内容区，将编辑/右区分隔比例设为 20%，文件区偏好宽度保留为 420 px。
- 基线证据：左区只有 127 px，文件区仍占 420 px，代码显示区为 0 px。原窗口最低 1000 × 720，探针先降低窗口限制再测量。
- 修复：编辑区至少 240 px，文件区至少 150 px并受可用空间限宽；保留用户原偏好，窗口恢复宽度后可恢复。编辑区不自动折叠，文件区继续手动收起。极窄时使用原生滚动承接。
- 回归：rc1-compact、rc1-compact-flow，覆盖题集/项目、亮暗主题、标签和文件菜单、分隔线拖动、补全与格式化。

## R9 · LPMake 诊断重复显示在输出和顶部 · P2

- 位置：`pad/src/App.vue:1148`、`pad/shared/diagnostics.ts:19`。
- 触发：保存 set_language("cpp") 后编译；原“输出”已有诊断，外层 action catch 又把同一消息写入顶部错误区。项目导入失败还存在只进入顶部提示的出口。
- 修复：复用 ConfigError 既有规范和诊断计数，统一切换到“输出”。编译、开始调试、终端 lpmake 构建及项目导入均覆盖；C/C++ 原始输出完整保留。
- 回归：rc1-diagnostics、rc1-lpmake-output 和构建设置流程；含语法错误、未知命令、缺失源文件、hint/note、失败后修复并实际编译成功，导入失败保留当前实验。

## R10 · 紧凑窗口查找替换遮掉全部代码行 · P2

- 位置：`pad/src/components/CodeEditor.vue:460`、`pad/src/themes.css:336`。原全局表单 label 样式位于 pad/src/style.css。
- 触发：640 × 380、文件区展开、编辑区 240 px，按 Ctrl+F。原生查找面板继承了应用表单的纵向 label 和大内边距；面板高约 214.8 px，代码滚动区实测为 0。
- 修复：只为原生面板隔离表单样式并保留代码基本高度；空间不足时页面滚动，不新增查找替换实现。Linux 实测面板降为约 109.7 px，代码显示恢复约 83 px。
- 回归：rc1-search-space 和两种工作区的 rc1-compact-flow；检查真实按键输入、单次替换、撤销、可命中控件及代码区高度。

## R11 · 菜单关闭后的延迟焦点恢复抢走代码输入 · P2

- 位置：`pad/src/menu-focus.ts:21`；四个菜单出口共用该策略，文件区沿用同一焦点判定。
- 触发：打开标签、文件、保存或实验选择菜单，按 Esc 后立即继续输入或触发补全。原代码接受 Reka 的延迟默认恢复；编辑器已获得焦点后，定时回调又把焦点移回标签或触发按钮。
- 证据：紧凑窗口完整流程中 Alt+/ 未到达 CodeMirror，焦点追踪确认最后落在源码标签；直接调用补全命令正常。并非补全排序或语法树失败。
- 修复：通过 Reka 的 open-auto-focus / close-auto-focus 公共钩子记录返回位置，阻止延迟默认恢复，按当前焦点同步返回；已有新的编辑焦点时不再抢占。Esc 单独关闭仍可返回原按钮，文件区内联命名保持原有焦点。
- 回归：`tests/ui/rc1-menu-focus.spec.ts` 与 `rc1-compact-flow.spec.ts`；真实菜单、真实按键与双帧后焦点断言，Windows 重复运行 6/6。库实现核对 FocusScope 与 DropdownMenuContent，并复用 [Reka 菜单钩子](https://reka-ui.com/docs/components/dropdown-menu)。

## R12 · 单文件命令追加多余语言重置，Clang 产生警告 · P2

- 位置：`pad/core/compiler.ts:228`、`pad/shared/parameters.ts:72`。
- 触发：自定义 Clang，单文件编译默认链接参数 -lm；旧命令在最后一份源码后仍追加 -x none，Clang 报 unused-command-line-argument。实测 Clang 19.1.7 在添加 -Werror 后，正常 main 函数也因此返回编译错误。
- 修复：复用参数 token 解析，只有后面确有对象/归档等输入时才重置强制语言；库目录、分写的 -l 参数和普通开关不触发多余重置。保留对象文件按其自身类型链接的语义。
- 回归：`tests/single-link-inputs.test.ts` 实际构建并运行外部对象链接，检查库参数下无多余重置；四套独立编译器矩阵拒绝该多余警告。Windows 原始命令对照记录：旧参数返回 1，移除多余重置后返回 0。

## U1 · 标题栏高度与窄分区操作

- 原测量：文件区 36、编辑标签 37、测试/调试 48、输出/终端 38 CSS px。
- 位置：`pad/src/style.css:2`、`pad/src/App.vue:535`、`pad/src/components/ActionMenu.vue:5`。
- 修复：统一 40 CSS px；右区保留收起和运行入口，次级操作随空间进入“更多”，恢复宽度后再显示。浮层挂载到窗口层，按窗口边界避让、限高和滚动。
- 复用 [Reka DropdownMenu](https://reka-ui.com/docs/components/dropdown-menu) 的 Portal、焦点管理、碰撞避让及 available-height 变量；不自建菜单定位或键盘循环。
- 回归：`tests/ui/rc1-interface.spec.ts`、`tests/ui/rc1-toolbar.spec.ts`，含窄分区、缩放、菜单超出分区范围、短窗口键盘访问。

## 主题黑底观察

Linux 与 Windows 均操作真实设置页面，连续四轮切换、两个缓存标签、32 个渲染帧核对，未见编辑器与界面主题底色不一致。另发现 `tests/ui/interface-state.spec.ts` 直接修改壳层 data-theme、未同步编辑器 props，可制造壳层与编辑器配色不一致；已改为实际设置操作。这个夹具缺陷不能解释用户观察到的每一次闪烁，正常路径的本轮逐帧检查没有复现。

## 巡检覆盖与保留的实现

| 业务链路 | 源码与检查重点 |
| --- | --- |
| 保存、切题与版本 | App 保存队列、Storage/Workspace 事务、显式构建目标、头文件/文本辅助标签；检查失败不毒化队列、旧响应不跨视图 |
| 文件事务 | FileService、路径同步、断点和终端目录映射、调试期间结构操作限制；对照失败回滚与唯一备份 |
| 构建与进程 | 单文件 Compiler、多文件 Build、CompiledProgram、Cache、Process、PTY；检查取消、租约、当前产物、原错误与清理独立性 |
| 调试 | DAP 连接/会话、栈帧、变量、监视、源码变更、停止与重启；保留检查代次和过时响应拒绝 |
| 补全与编辑 | CodeMirror 原生语法树和补全、声明/作用域/头文件缓存、Tab/Enter、格式化、字体和缓存 EditorState |
| 导入、比较与导出 | v1/v2 协议、测试点补丁、覆盖/追加、wcmp/float/strict、导出选题/版本/配置、路径及二进制数据 |
| CLI 与成绩 | 目录/ZIP 收件、完整版本保留、最高分选择、名单顺序、公开/隐藏测试、百分制闭合、CSV 评语及输出替换 |
| 界面与生命周期 | 亮暗主题、浮层、焦点、侧栏、缩放、字体范围、窗口与程序退出 |

现有 CodeMirror、diff、Reka、write-file-atomic、文件操作、PTY 与清理底座继续复用。上述十二项均有具体触发及可重复证据。

## 验证材料

隔离探针及两端原生日志在工作目录 rc1-final-audit 保存；可提交的回归位于 pad/tests。基线失败、修复后成功分开记录。报告不将模拟故障当作已定位的 OS 占用原因。


![窄右区的更多菜单跨出分区，并在窗口内完整显示](images/overflow-menu.png)


新增紧凑窗口和诊断检查的原始基线在 new-baselines.log；查找面板零高度记录在 new-expanded.log。最终双端回归与错误输出结构见 [验证记录](verification.md)、[错误输出示例](diagnostic-examples.md)。


本轮后续加入中英界面与紧凑工具栏，新增问题与验证记录见 [双语与紧凑布局核验](localization-verification.md)；最终发布包结果见 [验证记录](verification.md)。
