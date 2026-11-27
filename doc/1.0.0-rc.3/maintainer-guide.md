# LabPad 开放实验自动机判题需求与实现

适用版本为 v1.0.0-rc.3，更新于 2026 年 11 月 27 日。

rc.3 实现方案 A 的第一阶段。每个测试点可以用输出模板或 JSON 状态表定义比较规则，两种写法编译到同一个逐行执行器。现有运行器提供固定 stdin，在程序正常退出后将完整 stdout 交给执行器。交互式 EFSM 的协议与实现边界见本文末节。

## 课程用途

| 题目 | 自动检查 | 课程复核 |
| --- | --- | --- |
| Lab 5-1 四种排序 | 沿用 `wcmp` 比较样例中的两组整数和标签。 | 核对四种排序都处理同一份输入。 |
| Lab 5-2 四种排序计时 | 正整数数据量，随后按顺序输出 `selectionSort`、`bubbleSort`、`insertSort`、`quickSort` 的计时行。 | 核对实际排序、输入副本和计时区间。 |
| Lab 5-3 六种排序计时 | 再检查 `mergeSort` 和 `heapSort` 两行，兼容题面旧写法 `heapsort`。 | 核对归并排序与堆排序，以及六种算法的计时条件。 |

用时字段接受 `0.000` 等带三位小数的非负秒数。数据量填实际规模。运行时限和输出限额继续生效，计时字段的具体值不进入评分。课程仍按原题要求至少完成 5-1、5-2 之一，5-3 选做，取完成题目中的最高分。

## JSON 写法

比较规则和现有测试点格式共用 `comparison`。单点规则优先于题目默认规则。`type` 设为 `automaton`，在 `template` 与 `machine` 中选一项。`expectedOutput` 仍是字符串字段，可用空字符串，也可填一份格式样例。

### 模板

```json
{
  "id": "timing-format",
  "input": "",
  "expectedOutput": "Data size: 50000\nselectionSort uses 0.250 seconds!\nbubbleSort uses 1.125 seconds!\ninsertSort uses 0.031 seconds!\nquickSort uses 0.003 seconds!\nmergeSort uses 0.002 seconds!\nheapSort uses 0.005 seconds!\n",
  "comparison": {
    "type": "automaton",
    "ignoreTrailingSpaces": true,
    "template": {
      "lines": [
        "Data size: {{positiveInteger}}",
        "selectionSort uses {{seconds3}} seconds!",
        "bubbleSort uses {{seconds3}} seconds!",
        "insertSort uses {{seconds3}} seconds!",
        "quickSort uses {{seconds3}} seconds!",
        "mergeSort uses {{seconds3}} seconds!",
        "{{heapLabel}} uses {{seconds3}} seconds!"
      ],
      "fields": {
        "heapLabel": {
          "regex": "heap[Ss]ort",
          "description": "heapSort / heapsort"
        }
      }
    }
  }
}
```

`template.lines` 的每项匹配一整行。`{{名称}}` 引用内置字段或 `template.fields` 中的定义，一行可组合多个字段和固定片段。固定片段按字面匹配，因此括号、加号等字符可直接写。自定义字段写 `{"regex": "...", "description": "..."}`。`description` 用于失败提示，可省略。其他正则转义按 JSON 规则书写，例如把 `\d+` 写成 `"\\d+"`。

| 内置字段 | 格式 | 示例 |
| --- | --- | --- |
| `positiveInteger` | `[1-9][0-9]*` | `7`、`50000` |
| `seconds3` | `[0-9]+[.][0-9]{3}` | `0.000`、`16.889` |

### 状态表

适合可选行、分支和重复记录。以下规则接受零行或多行大写字母，最后一行须为 `END`。

```json
{
  "type": "automaton",
  "machine": {
    "initial": "rows",
    "accept": [
      "done"
    ],
    "states": {
      "rows": [
        {
          "match": {
            "text": "END"
          },
          "to": "done"
        },
        {
          "match": {
            "regex": "[A-Z]+",
            "description": "一行大写字母"
          },
          "to": "rows"
        }
      ],
      "done": []
    }
  }
}
```

每条转移消费一行，可用 `match.text` 或 `match.regex`。当多条转移可匹配同一行时，采用数组中第一条。例中 `END` 转移排在大写字母转移之前。状态名使用 1–64 个英文字母、数字、下划线、点或短横线，起始和目标状态必须声明，接收状态必须可达且使用空转移数组。rc.3 导入时会报出未知字段，便于定位拼写错误和当前版本无法运行的动作。

### 匹配与限额

- LF 和 CRLF 等价。最后一行可以有一个换行。到达接收状态后，任何额外行都判 WA，包含空行。提前到 EOF 会报告当前状态等待的内容。空模板匹配空 stdout。
- `ignoreTrailingSpaces` 默认为 `false`。设为 `true` 时，在比较前去除行尾 ASCII 空格和 Tab。前导空格、行内空格、行序和标点仍按规则匹配。
- RE2JS 将动态片段编译成整行匹配。支持分组、选项、字符类及重复。反向引用和环视会报规则错误。原生 JavaScript `RegExp` 不负责执行 JSON 中的表达式。CLI 和桌面构建均打包此依赖。 [RE2JS](https://github.com/le0pard/re2js) · [RE2 语法](https://github.com/google/re2/wiki/Syntax)
- 每条原始正则最多 512 个 UTF-16 码元，模板合成表达式最多 4096 个。计数式重复的显式边界最多 100，编译后最多 512 条指令。模板最多 128 行、16 个自定义字段。状态表最多 129 个状态、256 条转移，每个状态最多 8 条。
- 单行上限为 16384 个 UTF-16 码元，每次执行至多匹配 512 行。按行长度与候选规则的编译指令数扣减 800 万单位的匹配预算，字面规则按 1 计。超出匹配限制以 WA 给出失败位置。外部进程的 TLE、OLE、RE 和取消先于格式匹配处理。

## 桌面、CLI 与兼容

测试点卡将自动机的 `expectedOutput` 标为「格式样例」。WA 展示第一处失败的行号、状态、期望说明和实际文本。执行轨迹列出最近 8 次成功转移。严格比较模式继续使用原有 Diff。

`labpad judge` 的文本输出和 `labpad grade` 的 `cases.csv` 使用同一条诊断摘要，单次送测的 `--json` 附带 `automatonFailure`。自动机规则进入桌面判题指纹和 CLI 批测上下文，改动规则需要重测，修改格式样例不影响结果。规则变化可复用现有编译产物。

`pad/shared/automaton.ts` 负责编译和执行计划，`pad/shared/comparison.ts` 在已有规则入口中统一校验。桌面与 CLI 均调用 `pad/core/judge.ts`。进程退出后才进入比较器，两种写法在同一套状态循环中处理读行、转移和 EOF。已有 `wcmp`、`floatTokens`、`strictText` 的校验、运行与文件版本号沿用原约定。包含 `automaton` 的规则需要 rc.3。

## 第二阶段 · 交互式 EFSM

Lab 3-3 的交互试点需要先发布测试协议。游戏每局最多猜 7 次，保留自由编写的人机提示与续玩方式。正式评分继续采用教师规则，公开槽位只替换题面授权的文本。若测试器只见提示和猜值，区间一致性只能核对提示是否互相矛盾。验证实际答案还需要可核对的答案来源。

计划把现有的「消费一行 → 转移 → EOF」复用于协议事件，另在会话层负责读写和超时。后续可以在转移上定义守卫、变量更新和发送动作，描述偏大、偏小、猜中、七次未中、续局和退出。普通计时模板继续使用只读 stdout 执行器。

- **管道与提示语。** 管道运行时 stdout 可能整块缓冲，逐条协议事件须换行并刷新。管道不会回显用户输入，未换行的提示语可能与下一条协议记录粘连。试点需确定独立事件边界并验证 C 与 C++ 的刷新行为。PTY/ConPTY 还涉及回显、控制序列及 EOF，待跨平台验证。 [GNU libc 缓冲说明](https://www.gnu.org/software/libc/manual/html_node/Buffering-Concepts.html) · [Microsoft ConPTY](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session)
- **测试答案注入。** 评估受控环境变量等方式，让教师检查指定答案，无需改写学生源码。普通运行继续随机，跨工具链测试无需依赖相同的 `srand` 序列。注入格式和生效时机随题面发布。
- **公开槽位。** 为导出的源码包选择清晰的参数承载文件，由 CLI 按题目读取并校验类型、长度与允许值。学生提交的状态图、接收条件和自测结果与教师规则隔离。
- **单步空闲超时。** 为等待协议事件、发送输入和等待结束设置各自的空闲超时，仍使用整次运行的硬时限及输出限额。诊断区分缺少事件、提前 EOF 和进程退出。超时本身无法区分缓冲和程序逻辑停住。

历史选型中的场景预设、图形编排可在交互协议稳定后依据课程需求决定。
