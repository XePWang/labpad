# LabPad 助教指南

适用版本：0.1.0-dev.8（开发预发布）

撰写日期：2026-11-01

更新日期：2026-11-02

## 1. 实验下发与收件
向同学下发 LabPad 程序包、课程项目 JSON 和实验指导书。课程 JSON 单独分发，GitHub Release 只附程序包及校验文件。

同学导入项目、编写、自测后导出 ZIP，并通过课程平台上传。助教将提交文件保存在实验目录的 submit 中，再用同一 Judge 内核批测。公开测试用于自测，隐藏测试放在教师端单独配置。

题集按“学生 × 实验 × 题号”择优；多文件项目按“学生 × 实验 × 整份工程”择优。同一次完整提交的各测试点共同计算成绩，不能从多个版本拼接通过项或源文件。

## 2. 题集 JSON
v1 保持兼容；v2 可以明确写 mode: problem-set。UTF-8 文件示例：

~~~json
{
  "schemaVersion": 2,
  "kind": "labpad.project",
  "mode": "problem-set",
  "labId": "实验2",
  "problems": [{
    "problemId": "Lab 2-1",
    "language": "c",
    "source": ["#include <stdio.h>", "int main(void) {", "    return 0;", "}"],
    "timeLimitMs": 1000,
    "outputLimitBytes": 65536,
    "comparison": {"type": "wcmp"},
    "testCases": [{"id": "basic", "input": "8\n", "expectedOutput": "good morning.\n"}]
  }]
}
~~~

labId 是实验项目名，problemId 是题号。列表按 problems 顺序显示。language 可为 c 或 cpp；source 可为完整字符串或逐行数组。title 缺省为题号，language 缺省为 c，源码缺省为内置模板，默认时限 1000 ms、输出上限 65536 字节、比较方式 wcmp、测试点为空。

每题模板应保留需要学生完成的部分。测试输入不等于终端键盘回显，预期输出只写程序应打印的内容。项目名、题号和测试点编号必须唯一。

公开课程示例：[实验1](../../examples/lab-1.project.json)、[实验2](../../examples/lab-2.project.json)、[实验3](../../examples/lab-3.project.json)。实验1个性化参数使用虚构演示值；学生修改参数后需调整预期输出。实验3猜数字保留手动检查，避免用固定输出改变随机交互题意。

### 双语言源码模板
后续实验题同时提供 templates.c 和 templates.cpp；两项均接受字符串或逐行数组。language 决定初始打开的语言。source 指定初始源码；省略时使用该语言模板，再缺省则使用内置模板。新建 C/C++ 版本使用各自的 templates，旧版仅写 source 的项目继续可读。

~~~json
{
  "problemId": "Lab 4-1",
  "language": "c",
  "templates": {
    "c": ["#include <stdio.h>", "int main(void) {", "    return 0;", "}"],
    "cpp": ["#include <iostream>", "int main() {", "    return 0;", "}"]
  },
  "testCases": []
}
~~~

示例见 [dual-templates.project.json](../../examples/dual-templates.project.json)。多文件项目也可在顶层提供 templates，用于工具栏“新建源码”；文件树的通用新建文件从空白开始。附带配置的导出包保留两种模板，重新导入后仍可分别新建。

桌面与 CLI 的新配置统一使用 C17 / C++20；题集、项目以及关闭参数继承后的缺省标准保持一致。教师显式设置的旧标准继续生效，已有用户配置不自动改写。

## 3. 多文件项目 JSON 与 LPMake
多文件项目使用 schemaVersion: 2、mode: project，没有 problemId 层级。完整下发示例见 [multi-file.project.json](../../examples/multi-file.project.json)。

~~~json
{
  "schemaVersion": 2,
  "kind": "labpad.project",
  "mode": "project",
  "labId": "多文件示例",
  "build": {"system": "lpmake", "file": "LPMake.txt", "inheritDefaults": true},
  "tests": {
    "comparison": {"type": "wcmp"},
    "testCases": [{"id": "basic", "input": "1 2\n", "expectedOutput": "3\n"}]
  },
  "files": [
    {"path": "LPMake.txt", "content": "target(\"sum\")\nset_standard(\"c17\")\nadd_files(\"src/*.c\")\n"},
    {"path": "src/main.c", "content": "#include <stdio.h>\nint main(void){int a,b;scanf(\"%d%d\",&a,&b);printf(\"%d\\n\",a+b);}\n"}
  ]
}
~~~

files 在导入时展开为实际文件；使用 / 相对路径，不使用绝对路径、..、符号链接或大小写/Unicode 等价重名。LPMake 是唯一日常可编辑的构建描述；内部 JSON 只作为程序协议。

命令、语法和完整工程示例见 [LPMake 使用手册](lpmake-guide.md)。LPMake 首发 14 条命令：

| 用途 | 命令 |
| --- | --- |
| 目标、语言、标准 | target、set_language、set_standard |
| 模式与优化 | set_mode、set_optimize |
| 文件、目录 | add_files、remove_files、add_includedirs |
| 宏、库 | add_defines、add_linkdirs、add_links |
| 原始参数 | add_cflags、add_cxxflags、add_ldflags |

支持 # 注释、双引号字符串、跨行参数和尾随逗号，不执行脚本。默认按扩展名区分 C/C++；set_language("c++") 会把 .c 也按 C++ 编译，set_language("c") 同理覆盖 .cpp。两种标准可以共存，例如 c11 与 c++20，各自只出现一次。

默认 debug 使用 -g -O0 -UNDEBUG；release 使用 -O2 -DNDEBUG。set_optimize 覆盖优化级别，原始参数最后生效。包含目录保持声明顺序，源集合为 add_files 展开后减去 remove_files，按确定顺序构建。

项目构建设置与 LPMake 共享编辑缓冲。格式化按钮仅处理 C/C++ 等源码，不格式化 LPMake。

## 4. 比较规则
| type | 语义 | 适用题目 |
| --- | --- | --- |
| wcmp | 按空白分隔 token；数字字面量、提示语和标点精确比较 | 一般标准 I/O |
| floatTokens | 数字按容差，其他 token 精确比较 | 数值计算 |
| strictText | 统一 CRLF/LF 后比较文本 | 金字塔、空格与换行排版 |

~~~json
{"type":"floatTokens","absoluteTolerance":0.00001,"relativeTolerance":0.00001}
~~~

标准值 e、实际值 a 满足 |a-e|≤A 或 |a-e|≤R×|e| 即通过。每个测试点可提供自己的完整 comparison 覆盖整题默认值，因而可仅部分点使用浮点比较。标签与数字要分成不同 token，例如 Root: 1.769292，而不是 Root:1.769292。

~~~json
{
  "id": "layout",
  "input": "C\n",
  "expectedOutput": "  A\n ABA\nABCBA\n",
  "comparison": {"type":"strictText","ignoreTrailingSpaces":true,"ignoreFinalNewlines":true}
}
~~~

strictText 的两项忽略选项默认 false；开启后仍检查行首缩进、行内空格及正文空行。测试应说明采用哪种规则，避免让显示格式承担未定义的评分要求。

## 5. 更新、追加及导出测试点
单题文件使用 kind: labpad.testCases、schemaVersion: 1。testCases 必填，其余规则可省略。可携带 labId、problemId；携带时必须与目标精确匹配。

覆盖时只更新输入文件明确写出的规则。追加时保留原测试点和原默认规则，将导入默认 comparison 落到新增点上；重复 id 会改名并预览。时限、输出限制是整题属性，追加时单独选择是否采用。

整项目测试点使用独立类型：

~~~json
{
  "schemaVersion": 2,
  "kind": "labpad.projectTests",
  "mode": "problem-set",
  "labId": "实验2",
  "problems": [{
    "problemId": "Lab 2-1",
    "testCases": [{"id":"new","input":"8\n","expectedOutput":"good morning.\n"}]
  }]
}
~~~

多文件模式把 problems 换成 tests，mode 写 project。通过“导入实验项目”进入更新流程。导入完整项目 JSON 也能选择更新测试点，源码、模板和构建设置保留。缺省字段保留当前值；明确的 testCases: [] 会清空该目标的测试点。未列出的题目不变，名称或模式不符整批拒绝。

“导出当前测试点 / 项目测试点”导出全部配置点，包含点级规则，不包含源码及实际运行输出。导出项目时勾选附带配置，可将 ZIP 在新数据目录中重建；题集保留本次所选版本，多文件保持目录结构。保存窗口选定的 ZIP 名称同时用于包内外层文件夹，内部源码和 LPMake 不改名。

## 6. 部署命令行判题机
Linux CLI 包需要 Node.js 22+、GCC/G++ 或指定的 Zig；默认隔离运行需要 Bubblewrap。Ubuntu 可安装 nodejs、gcc、g++、bubblewrap；核对 node --version 满足要求后，解压 CLI 包并运行 ./labpad --help。

建议目录：

~~~text
lab4/
├─ grade.json
├─ project.json
├─ roster.csv
├─ hidden.io.json
├─ submit/          原始收件，保留每次提交
├─ src/             完整候选快照和 index.json
├─ build/           临时运行、构建缓存
└─ output/          summary.csv、cases.csv、state.json、intake.json
~~~

配置示例：

~~~json
{
  "schemaVersion": 1,
  "project": "project.json",
  "roster": "roster.csv",
  "weights": {"main": 1},
  "hiddenTests": {"main": "hidden.io.json"},
  "compiler": {"kind": "gcc"},
  "isolation": "bubblewrap"
}
~~~

题集 weights、hiddenTests 按实际 problemId 配置；多文件项目统一使用 main 作为评分目标。权重先计算各题通过比例，再归一化到 100 分。计分目标必须有测试点。编译器路径可通过 compiler.cPath、cppPath 指定；kind 为 zig 时指定 Zig 可执行文件。

名单接受 CSV、XLS、XLSX，识别序号、学号、姓名，保持原名单顺序。学号使用文本，保留前导零。CSV 是后续外部整理的中间文件；评语在 LabPad 之外编写。

## 7. 单题、单项目与批量送测
~~~sh
# 单文件 + 单题测试
./labpad judge --source solution.c --tests problem.io.json --compiler gcc

# 单文件 + 项目中的指定题
./labpad judge --source solution.cpp --tests project.json --problem "Lab 2-1"

# 一个多文件目录，也可把目录换成完整 ZIP
./labpad judge --project ./student-project --tests project.json --compiler zig --cc /opt/zig/zig --json

# 全部收件
./labpad grade /path/to/lab4

# 指定学生续测，保留其他行和已有评语
./labpad grade /path/to/lab4 --student 7355608
~~~

单项目 judge 采用该目录的 LPMake。批量 grade 强制采用教师 project.json 的测试点，默认锁定教师 LPMake，学生包内同名文件不会更换教师构建规则。

确需允许学生自定义构建时，教师显式设置 allowStudentBuild: true。它只接受声明式项目及受限原始参数：常用警告、语言标准、优化/调试、pthread 等；外部路径、响应文件和插件加载不属于此入口。教师自身配置保留完整参数能力。

批量多文件收件接受以学号命名的完整目录或 ZIP。保留外层提交来源，只剥离共同的单层外目录；源码和头文件一起构成一个候选。多个提交独立保存，评分取最高的完整候选；同分按首次收录的稳定序号。覆盖同名收件后重跑，之前收录的版本仍参与择优。

## 8. CSV 与补交核对
summary.csv 按名单顺序包含：

- 有效文件、缺交题号、状态。
- 每题的有效文件、编译状态、来源、SHA256、源码快照位置。
- 每题通过数、总测试点和归一化得分。
- 得分100、满分、扣分、依据、评语。

cases.csv 包含采用版本的逐点通过情况、公开/隐藏范围、是否实际运行、耗时和比较模式。编译失败时测试点标记未运行，不制造运行结果。得分和扣分闭合到 100，显示的逐题得分与总分一致。

intake.json 列出坏包、非法路径、身份不明等收件问题。存在尚不能判定的候选且没有确认满分版本时，会保留“待核对”，不直接按零分结案。检查后修复收件，再按学号重测。

单人续测要求项目、测试、名单、工具链和构建配置与上次一致；发生变化需全量重测，避免把不同评分基线的行混在一起。外部已有评语按学号保留。

## 9. 发放前检查
用教师参考程序实际跑全部测试，覆盖正常值、边界值及异常输入；对排版题查看每行空白，对浮点题核对容差及停止条件。然后用“未完成模板”“错误答案”和“无法编译源码”各走一次导入、自测、导出流程。

项目导出后放到全新数据目录重新导入，确认源码、头文件、LPMake 和测试点齐全。更换公开测试后说明更新方式；更换评分基线后全量重测。
