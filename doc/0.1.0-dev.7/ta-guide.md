# LabPad 助教指南

适用版本：0.1.0-dev.7
撰写日期：2026-10-31
最近核验：2026-10-31；执行证据见[验证记录](verification.md)。

## 1. 准备并下发实验项目

下发桌面程序、课程指导书和公开项目 JSON。学生导入项目后即可取得题号、源码模板及测试点。examples 中提供[实验1](../../examples/lab-1.project.json)、[实验2](../../examples/lab-2.project.json)、[实验3](../../examples/lab-3.project.json)和[单题 I/O](../../examples/sum.io.json)。

~~~json
{
  "schemaVersion": 1,
  "kind": "labpad.project",
  "labId": "实验2",
  "problems": [
    {
      "problemId": "Lab 2-1",
      "title": "按时间问候",
      "language": "c",
      "source": [
        "#include <stdio.h>",
        "",
        "int main(void) {",
        "    // 在这里编写代码",
        "    return 0;",
        "}"
      ],
      "timeLimitMs": 1000,
      "outputLimitBytes": 65536,
      "comparison": {"type": "wcmp"},
      "testCases": [
        {"id": "morning", "input": "8\n", "expectedOutput": "good morning.\n"}
      ]
    }
  ]
}
~~~

labId 是实验项目名，problemId 是提交文件中的题号。problems 的数组顺序就是下拉顺序。language 可选 c / cpp，默认 c；source 可为字符串或逐行数组，省略时使用默认模板。title 默认等于题号，时限默认 1000 ms，输出上限默认 65536 字节，测试点默认空数组。

导入前会校验整批内容。同名项目可取消或导入为副本；非法题号、重复题号和错误规则会阻止导入，并保留现有项目。

服务器隐藏测试单独保存。公开示例 hidden-lab-2-1.io.json 只演示配置结构，正式验收应另行准备数据。

## 2. 单题 I/O 与比较规则

更新当前题目的测试时使用：

~~~json
{
  "schemaVersion": 1,
  "kind": "labpad.testCases",
  "comparison": {"type": "wcmp"},
  "testCases": [
    {"id": "1", "input": "1 2\n", "expectedOutput": "3\n"}
  ]
}
~~~

testCases 替换当前测试点。comparison、timeLimitMs、outputLimitBytes 可省略，省略时保留原值。它不改变当前项目、题号或源码。每个测试点的 id 必须唯一。

| type | 用途 |
| --- | --- |
| wcmp | 按空白分隔 token 比较；3.0 和 3.00 不同，提示语仍参与比较 |
| floatTokens | 数值 token 按容差比较；其他 token 精确匹配 |
| strictText | 检查缩进、行内空格及换行排版 |

整题 comparison 是默认规则；测试点内的 comparison 完整覆盖本点规则：

~~~json
{
  "id": "decimal",
  "input": "1 3\n",
  "expectedOutput": "0.333333\n",
  "comparison": {
    "type": "floatTokens",
    "absoluteTolerance": 0.000001,
    "relativeTolerance": 0.000001
  }
}
~~~

设标准值 e、实际值 a，通过条件是 |a-e| ≤ absoluteTolerance **或** |a-e| ≤ relativeTolerance × |e|。至少设置一项有限非负容差。整题浮点加个别 wcmp，或整题 wcmp 加个别浮点，均可使用。

排版题可配置：

~~~json
{
  "type": "strictText",
  "ignoreTrailingSpaces": true,
  "ignoreFinalNewlines": true
}
~~~

strictText 将 CRLF 统一为 LF。两个选项默认 false：默认比较行尾空格和文件尾换行。ignoreTrailingSpaces=true 忽略每行末尾的普通空格及 Tab；ignoreFinalNewlines=true 忽略文件尾的 LF。行首缩进、行内空格、正文空行、Tab 与空格的区别、全角字符均保留。实验2金字塔开启上述两项，仍要求正确缩进。

题目数据保存在数据目录内相邻 JSON 中；源码独立保存在 .c/.cpp。修改规则后重新测试，旧结果会失效。

## 3. 校验课程示例

发布前用参考程序运行公开测试，并分别核对 GCC、Zig 的行为。输入回显和“↙”不属于 stdout。

实验1的 Lab 1-2 是固定虚构参数 x=12、y=8 的演示测试。学生改个人参数后应调整预期输出，正式验收结合其源码参数和验算记录进行，不能用演示答案统一评判所有参数。

实验2包含四道热身及四道 Lab 题。金字塔使用普通英文空格及对称字母序列，第三行按 ABCBA；回文素数时限明确为 5000 ms；优先编码器包含中文输出。指导书中的 32 MB 内存要求尚不是题目协议里的限制。有关 fflush(stdin) 的代码，按实际工具链记录行为，不将其视作可移植输入清理方法。

实验3包含 Lab 3-1 至 Lab 3-4，共 21 个自动测试点：

| 题号 | 检查安排 |
| --- | --- |
| Lab 3-1 | 10 组人数，覆盖最小合法人数 2、连续小值、中间值及 32 位有符号整数范围内的较大值 20、21 |
| Lab 3-2 | 1 个无输入的完整输出测试，校验全部七种搭配及遍历顺序 |
| Lab 3-3 | 10 项手动检查写入源码模板；空测试集用于进入交互调试 |
| Lab 3-4 | 10 组参数，覆盖正负根、零根、多实根、初值已满足精度、导数为零和步长终止 |

Lab 3-2 的输出固定，重复运行同一输入不会增加覆盖；因此保留完整输出检查。Lab 3-3 的随机数、提示和继续方式由学生设计；按模板清单检查，必要时在临时副本固定答案，提交前恢复随机生成。

Lab 3-4 为选做题。本项目将指导书中的输出调整为标签与数字间有一个空格，例如：

~~~text
Iterations: 4
Root: 1.769292
~~~

这样 Iterations:、Root: 精确匹配，独立的数值 token 使用 absoluteTolerance=1e-5、relativeTolerance=1e-5，满足其一即可。统一计数约定：

1. 令次数为 0，当前估计为 x0。
2. 每轮先检查 |f'(x)| < 1e-12 或 |f(x)| < ε；满足时输出当前估计，次数不变。
3. 否则计算下一估计值，次数加 1，并更新当前估计。
4. 若新旧估计之差的绝对值小于 ε，则输出更新后的值；否则开始下一轮。

六个测试点覆盖指导书两例、正根、负根、无理根及零初值。源码模板中也写明格式、检查顺序和计数方式。

## 4. 建立命令行批测环境

下载 Release 中的 CLI Linux x64 包，解压后安装 Node.js 22 或以上版本及 GCC/G++，将包内 labpad 放入 PATH，或用完整路径调用：

~~~sh
node /path/to/labpad.cjs --help
~~~

CLI 自带所需 JavaScript 依赖和本平台 Checker。默认使用系统 GCC，也可在配置中指定 Zig。源码构建方式见维护者文档。

批量运行学生程序时，使用受限评测主机和专用账号。Linux 批测默认通过 Bubblewrap 运行每个测试程序；先安装 bubblewrap，并确认系统允许用户命名空间。编译工具仍由评测账号运行，账号也应只具备实验所需权限。程序只看到必要运行库、当前用例工作目录及自身可执行文件，不能看到其他题的答案目录。

如果主机策略不允许 Bubblewrap，先调整评测环境。isolation: "none" 用于可信参考程序和本地夹具验证，不作为隔离部署的替代品。

## 5. 文件组织与 grade.json

~~~text
课程目录/
├─ refs/
│  └─ roster.xls
└─ lab2/
   ├─ grade.json
   ├─ project.json
   ├─ hidden-lab-2-1.io.json
   ├─ submit/
   ├─ src/
   ├─ build/
   └─ output/
~~~

将原始 ZIP、补交 ZIP 或源码目录原样放到 submit。可接受一个统一收件 ZIP 中包含多个学生 ZIP；源码版本按来源分别保留。src 保存可追溯源码及 index.json。后续收件即使覆盖了 submit 中的同名文件，已收录的完整版本仍保留并参与择优；内容未变的重复送测不会增加副本。保留 src，才能延续版本记录。build 保存可重建产物和缓存，output 保存 CSV 及续测状态。

参考 [grade.json 示例](../../examples/grade.json)：

~~~json
{
  "schemaVersion": 1,
  "project": "project.json",
  "roster": "../refs/roster.xls",
  "weights": {"Lab 2-1": 2, "Lab 2-2": 3},
  "hiddenTests": {"Lab 2-1": "hidden-lab-2-1.io.json"},
  "compiler": {"kind": "gcc", "cPath": "gcc", "cppPath": "g++"},
  "isolation": "bubblewrap"
}
~~~

路径相对于实验目录。project 指完整项目 JSON；roster 支持 UTF-8/GBK CSV、XLS、XLSX，表头含学号、姓名，可带序号，保留实际名单顺序。学号应在表格中存为文本，避免前导零或长数字丢失。

weights 使用非负整数；未列出的题权重为 0。上述设置将两道必做题归一化为 40 与 60 分，热身和选做按配置不计入这 100 分。计分题必须有测试点。hiddenTests 将指定 I/O JSON 的点追加到该题；同名公开/隐藏测试点会分别记录来源。

使用 Zig 时设置 kind: "zig"、cPath 为 zig 的完整路径；GCC/Clang 分别填写 C 和 C++ 路径。cArgs、cppArgs、linkArgs 可显式设置字符串数组，默认 C17/C++17、-O2、-Wall、-Wextra 及 -lm。不同工具链的标准和参数应在本次验收中保持一致。

## 6. 批量、单人和单文件送测

~~~sh
labpad grade lab2
labpad grade lab2 --student 7355608
labpad judge --source solution.c --tests problem.io.json --compiler gcc
labpad judge --source solution.cpp --tests project.json --problem "Lab 2-1" --compiler zig --cc /opt/zig/zig --json
~~~

grade 会识别学号与完整题号；LabPad 导出的 _v2、_v3 等后缀属于同题的不同版本。C 和 C++ 分别编译，同一次实验、同一学生、同一题的所有完整版本参加评测。采用通过比例最高的一份，同分按稳定来源顺序选择。不同题可以取自不同次提交，同题不会拼接不同版本的通过点。

开始评分前会验证编译器并实际编译一份可信的 C/C++ 小程序；路径或参数不可用时停止任务，保留原报告，避免把环境故障记成学生编译失败。

单人重测保留名单其他行及已有“评语”。项目、测试、名单、编译器或隔离模式变化时，单人重测会要求全量重测或新目录，避免混合评分口径。首次只送测一人时，其他名单行标为“未送测”。Ctrl+C 取消任务后，原 output 保留。

单文件 judge 的退出码：全部通过为 0，答案/编译未通过为 1，配置或任务错误为 2。--json 输出完整单次结果，便于外部工具读取。

## 7. 阅读 CSV 与整理评语

summary.csv 按点名册顺序，每人一行：

- 是否取得有效文件、缺交题号及处理状态。
- 每题的有效文件、编译状态、采用版本来源、源码路径、SHA-256。
- 每题通过数、测试点总数、折算得分，以及得分100、满分、扣分。
- 客观依据和留空的评语列。

cases.csv 按名单、题目、测试点顺序，列出采用版本的逐点结果、公开/隐藏范围、比较模式、是否运行、耗时和简短说明。

“有效文件”表示可归属、可解码且非空的 .c/.cpp。编译失败仍属于已交有效源码，分数为 0，测试点标为未运行 CE。缺交与空源码分别记录。坏包、身份冲突和评测任务错误需要核对；如果尚不能确认最高版本，不把未知情况直接算成学生 0 分。

每题按通过点比例乘权重，再归一化为满分 100。显示的小数会分配舍入差，使各题分数之和等于总分，扣分与总分合计 100。

CSV 使用 UTF-8 BOM。用 Excel 打开时，学号列按文本导入。完整源码在 src 中，原包在 submit 中；不要从 CSV 的短说明替代源码审阅。output/state.json 支持单人续测，intake.json 列出收件异常。

将选定源码与客观 CSV 在外部手动交给大模型或人工整理评语，复核后填入课程成绩单。LabPad 不调用模型接口。若课程成绩单满分为 5，换算为“得分100 × 5 / 100”。

## 常见处理

| 情况 | 操作 |
| --- | --- |
| 发现补交 | 新增原包到 submit，再按学号重测 |
| 同题多个 C/C++ | 全部保留，查看 CSV 的采用来源 |
| 题号或身份无法匹配 | 查看 intake.json，核对原包和名单后重测 |
| Checker 或编译器不可用 | 修复环境再测，保留任务错误记录 |
| 容差或时限变更 | 全量重测，使用同一配置生成一批结果 |
| build 变大 | 无任务时清理 build；会重新建立缓存和编译产物 |
| ZIP 异常 | 检查损坏、加密、链接、越界路径及体积限制；保留原始包 |
