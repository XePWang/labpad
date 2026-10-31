# LabPad

LabPad 是面向 C/C++ 程序设计实验的本地自测工具：导入课程项目、编写代码、比较测试输出，再导出源码或实验 ZIP。助教可用同一判题内核在命令行批量测试提交文件。

当前版本：**0.1.0-dev.7（预发布）**。[下载](https://github.com/XePWang/labpad/releases/tag/v0.1.0-dev.7) · [全部版本](https://github.com/XePWang/labpad/releases)

支持 Windows x64、Linux x64、macOS arm64。桌面包自带 Zig 和离线格式化器，完整解压后启动即可。macOS 的签名及实机核验范围见[版本验证记录](doc/0.1.0-dev.7/verification.md)。

## 文档与快速开始

| 使用者 | 文档 |
| --- | --- |
| 同学 | [学生指南](doc/0.1.0-dev.7/student-guide.md)：下载安装、编写自测、源码版本、导出上传与 FAQ |
| 助教 | [助教指南](doc/0.1.0-dev.7/ta-guide.md)：项目 JSON、比较规则、批测、CSV 与补交 |
| 维护者 | [技术说明](doc/0.1.0-dev.7/maintainer-guide.md)：模块、存储、进程、构建与验证 |

1. 下载对应桌面包，完整解压并启动 LabPad。
2. 在“设置”中填写班号、姓名、学号。
3. “导入 → 导入实验项目”，选择课程 JSON。
4. 选择题号，编写代码，按 F9 或 Ctrl+Enter 自测。
5. “导出 → 导出实验项目”，勾选题号及版本，检查提醒，生成 ZIP 后上传课程平台。

![LabPad 编辑与测试界面](doc/0.1.0-dev.7/images/workspace-dark.png)

## 编辑、调试与保存

- CodeMirror 6 提供 C/C++ 语法、上下文缩进、查找替换和独立撤销历史。空格显示为淡色小点，Tab 可设为 1 / 2 / 4 空格。
- 一条标签栏管理同题多版本，格式化按钮按编辑状态显示；关闭全部标签后保留“新建源码 / 最近源码”。
- 手动保存默认开启；保存时默认使用离线 WASM clang-format，可在设置中调整。
- 源码统一导入为数据目录中的副本，保存当前 / 全部更新副本。切题打开最近五份，旧版本仍保留。
- 测试点可全部、部分、单点运行，也可定位及重测未通过项；颜色和简明说明帮助识别 AC、WA、CE、TLE、RE、OLE。
- “输出”保留原始编译与运行信息；“调试”提供独立的 > 输入行、中文输入、EOF 和停止操作。
- 编辑区与测试点、输出区之间可拖动调整；亮暗主题、界面缩放、快捷键和自定义编译器均可设置。

数据默认保存在程序旁的 labpad 文件夹。设置中可选择已存在的空文件夹来迁移数据，并浏览编译器路径。Zig 启动时静默预热，缓存超过 2 GiB 自动回收，也可手动清理。

Mac 默认使用 Command+S 保存、Command+Option+S 保存全部、Command+Option+F 替换；运行仍为 F9 / Control+Enter。Command+H、Command+Q 保留系统行为，详细默认键位及实测状态见指南。

## 导入格式

### 实验项目

[实验1](examples/lab-1.project.json)包含 Lab 1-1、Lab 1-2、Lab 1-3；[实验2](examples/lab-2.project.json)包含 warmup 2-1 至 2-4、Lab 2-1 至 2-4；[实验3](examples/lab-3.project.json)包含 Lab 3-1 至 Lab 3-4。

~~~json
{
  "schemaVersion": 1,
  "kind": "labpad.project",
  "labId": "实验2",
  "problems": [
    {
      "problemId": "Lab 2-1",
      "language": "c",
      "source": ["#include <stdio.h>", "int main(void) {", "    return 0;", "}"],
      "comparison": {"type": "wcmp"},
      "testCases": [
        {"id": "morning", "input": "8\n", "expectedOutput": "good morning.\n"}
      ]
    }
  ]
}
~~~

题号按 problems 顺序显示，每题可选择 c/cpp。source 支持完整字符串或逐行数组，省略时使用默认模板；title 默认等于题号。时限默认 1000 ms，输出上限默认 65536 字节，测试点默认空数组。同名项目可取消或建立副本。

课程示例提供编写起点与公开样例。Lab 1-2 使用固定虚构参数 x=12、y=8，修改个人参数后应同步修改预期输出；金字塔使用严格文本；回文素数配置 5000 ms。实验3的猜数字游戏使用交互调试；选做牛顿迭代题在标签与数字之间保留空格，绝对、相对容差均为 1e-5，迭代计数约定见助教指南。输入回显不属于程序输出。详细格式见助教指南。

### 标准 I/O

“导入 → 导入标准 I/O”只更新当前题目。[求和示例](examples/sum.io.json)、[单点浮点覆盖示例](examples/mixed.io.json)：

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

testCases 替换当前测试点；comparison、timeLimitMs、outputLimitBytes 可省略，省略时保留当前设置。题目 JSON 不包含学生源码，源码与版本元数据分别持久化。

### 比较规则

- wcmp：按空白分隔 token 比较，保留提示语、标点及数值字面量，3.0 与 3.00 不同。
- floatTokens：数值满足绝对误差或相对误差任一条件即通过，其他 token 精确匹配。
- strictText：比较文本、缩进和换行，统一 CRLF/LF；默认保留行尾空白及末尾换行。

整题 comparison 提供默认值，每个测试点可以完整覆盖。例如：

~~~json
{
  "id": "pyramid",
  "input": "C\n",
  "expectedOutput": "  A\n ABA\nABCBA\n",
  "comparison": {
    "type": "strictText",
    "ignoreTrailingSpaces": true,
    "ignoreFinalNewlines": true
  }
}
~~~

两项默认 false，开启后分别忽略行末普通空格/Tab 和文件尾 LF；行首缩进、行内空格及正文空行仍比较。

~~~json
{"type":"floatTokens","absoluteTolerance":0.000001,"relativeTolerance":0.000001}
~~~

对标准值 e、实际值 a，满足 |a-e| ≤ A **或** |a-e| ≤ R×|e| 即通过。可只配置一项。

## 导出

“导出源码”生成当前 .c/.cpp。“导出实验项目”先展示题号与版本两层复选框，默认全选；取消题号取消本题全部版本，取消一个版本只减少该文件，部分选择显示半选。只有勾选版本参与预检和 ZIP。

未编辑、未全部通过及身份缺项会提醒；身份缺项可点击“前往设置”，保存后保留选择继续导出。同题多版本使用原名、_v2、_v3 后缀，列表预览最终文件名：

~~~text
9527_马冬梅_7355608_实验2.zip
└─ 9527_马冬梅_7355608_实验2/
   ├─ 7355608_Lab 2-1.c
   ├─ 7355608_Lab 2-1_v2.cpp
   └─ 7355608_Lab 2-2.c
~~~

空项目导出为“学号_空项目.c/.cpp”；未填写学号则为“空项目.c/.cpp”。上传由使用者在课程平台完成。

## 命令行批测

CLI Linux x64 包需要 Node.js 22+、GCC/G++ 或 Zig；直接复用桌面 Judge。实验目录采用 submit / src / build / output，[评分配置示例](examples/grade.json)指定项目、名单、隐藏测试与权重。

~~~sh
labpad judge --source solution.c --tests problem.io.json --compiler gcc
labpad grade lab2
labpad grade lab2 --student 7355608
~~~

按“学号 × 实验 × 题号”完整测试所有版本，择最高分，同分按稳定来源顺序选择。summary.csv 按名单顺序输出有效文件、逐题通过数与百分制得分；cases.csv 输出采用版本的逐点结果。单人重测保留其他行与已有评语；评语由使用者在外部整理。

Linux 批测默认使用 Bubblewrap；安装与环境预检、CSV 字段和可信夹具的直接运行方式见助教指南。

## 版本更新

### 0.1.0-dev.7

- 合并编辑区重复标题；格式化操作移至标签栏，增加最近源码及恢复快捷键。
- 导出项目支持题号与源码版本两层复选、半选和多版本命名；补填身份后继续本次导出。
- 新增 strictText，可按题目或单点检查缩进、空格和换行。
- 增加选择/单点/失败项重测、整卡语义色、结果说明及题号测试状态；部分结果按源码及规则指纹合并。
- 调试增加独立 > 输入行；操作错误移除 Electron 包装文字，保留原始编译诊断。
- 按 macOS 常用约定完善默认快捷键及旧配置迁移。
- 新增 TypeScript CLI，支持目录/嵌套 ZIP、XLS/XLSX/CSV 名单、完整版本择优、隐藏测试、百分制与单人续测。
- 补充实验1、实验2完整项目示例和三份版本化指南；课程数据后续补充实验3，包括随机交互题与牛顿迭代浮点样例。平台验证范围与完整流程证据见[验证记录](doc/0.1.0-dev.7/verification.md)。

### 0.1.0-dev.6

- 工具栏“新建源码”支持 C / C++；优先使用当前题目的对应语言模板，未预设时使用默认源码。关闭全部标签后，编辑区也保留新建入口。
- “导入”菜单依次提供源码、标准 I/O 和实验项目；源码统一导入为数据目录中的副本，旧版外部文件关联自动转为副本。
- 修正 Windows 调试页的 UTF-8 输入输出；源码支持 BOM 与 UTF-16，项目副本统一保存为 UTF-8。
- 每题支持多份源码及单编辑区标签页；保存当前 / 全部、标签右键菜单和独立撤销历史；切题打开最近编辑的五份源码。
- 新建项目与首题保留当前代码。
- F9 / Ctrl+Enter 运行、终端 Ctrl+C 中断；新增独立快捷键设置窗口和界面缩放。
- 启动后静默预热 Zig，实际任务优先；编译缓存自动回收和手动清理，回收遗留运行目录。
- 测试点可单独覆盖整题比较规则，支持部分或全部测试点使用浮点容差。
- 46 项核心测试、Windows / Linux 成品各七个桌面场景通过，覆盖中文交互、编码、多版本、快捷键、原子保存、导入导出和反复运行的资源回收。


### 0.1.0-dev.5

- 导入、导出改为下拉菜单，支持整个实验项目 JSON 导入及源码 ZIP 提交包。
- 导出前按题提示未编辑、未全部通过和身份信息缺项；记录测试对应的代码、规则及编译器，修改后需重新测试。
- 项目支持逐题 C/C++ 语言及外部源码关联；同名导入可建立副本，项目导入和导出文件使用原子操作。
- 状态栏精简为左右各一项，按操作短暂显示信息，扩充空闲提示；个人信息增加示例占位文字。
- Windows / Linux 隐藏系统菜单栏，设置页移除冗余提示；SVG 与各平台图标统一使用圆角箭头。
- 34 项核心集成测试、Windows / Linux 成品桌面回归通过，覆盖快捷键、原子撤销、导入导出、取消与写入失败、分栏布局及重启恢复。



### 0.1.0-dev.4

- 合并运行操作行，移除冗余说明；底部状态栏跟随光标、选区和操作更新，并轮换实用提示。
- 编辑器 / 测试点宽度与输出 / 调试高度均可拖动调整，支持分隔线方向键操作并保存布局；窄分栏自动适配，调试终端自动重排。
- 自定义编译器自动检测：扫描 PATH 和常用安装目录，由用户选择，自动适配类型、路径及默认参数。
- 路径设置统一使用“C 编译器路径 / C++ 编译器路径”。
- 25 项核心集成测试通过；Windows / Linux 最终包通过完整桌面回归，包括 12 组编辑器、5 组自动检测和 7 组布局检查。

### 0.1.0-dev.3

- 原生空格可视化，1 / 2 / 4 空格缩进，C/C++ 上下文自动缩进。
- 亮色 / 暗色主题，界面、编辑器和终端同步切换。
- 离线 WASM clang-format；格式化按钮、快捷键与默认开启的保存时格式化。
- 格式化原子撤销、跨文件历史隔离、原文件原子保存与并发编辑保护。
- 18 项核心测试，以及 Windows / Linux 发布包完整桌面测试、每平台 12 组编辑器检查通过。

### 0.1.0-dev.2

- 项目与题号下拉选择、新建、空项目导出及官方图标。
- 无测试点时自动进入交互调试；手动 / 自动保存及原文件写回。
- 数据目录迁移、编译器路径浏览和校验、持久化编译缓存。

### 0.1.0-dev.1

- 首个开发预发布：单文件 C/C++ 编译、自测、标准 I/O 导入、比较与 Diff、交互调试及源码导出。

## 开发与验证

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

源码在 pad，构建与工具链在 .work。开发使用 Node.js 24；build 生成桌面、worker 与 CLI。工具链目标可选 linux-x64、win-x64、mac-arm64；设置 LABPAD_TEST_EXECUTABLE 可以测试实际发布包。构建、打包、运行时目录及文档维护约定见维护者说明。

项目采用 MIT；各依赖按其许可证分发。[第三方声明](pad/THIRD_PARTY_NOTICES.md)
