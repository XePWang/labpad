# LPMake 使用手册

适用版本：LabPad 1.0.0-rc.1

撰写日期：2026-11-01

更新日期：2026-11-09

LPMake 用来说明一个多文件实验中要编译哪些文件、使用什么语言标准和参数。它放在项目根目录，文件名为 **LPMake.txt**。LabPad 读取它构建一个可执行程序，再用项目测试点自测或进入交互调试。

项目只采用 LPMake 的参数，本机设置仅选择编译器类型和路径。新建项目默认 C17 / C++20、Debug；缺省标准也为 C17 / C++20。set_standard() 可明确指定其他标准。

## 1. 从一个 C 项目开始
文件结构：

~~~text
LPMake.txt
include/
  sum.h
src/
  main.c
  sum.c
~~~

LPMake：

~~~text
# src 中新增的 C 文件会自动参与构建
target("sum")
set_standard("c17")
add_includedirs("include")
add_files("src/*.c")
~~~

include/sum.h：

~~~c
#ifndef SUM_H
#define SUM_H
int sum(int a, int b);
#endif
~~~

src/sum.c：

~~~c
#include "sum.h"
int sum(int a, int b) { return a + b; }
~~~

src/main.c：

~~~c
#include <stdio.h>
#include "sum.h"

int main(void) {
    int a, b;
    if (scanf("%d%d", &a, &b) != 2) return 1;
    printf("%d\n", sum(a, b));
    return 0;
}
~~~

给程序输入 1 2，应输出 3。完整的可导入项目见 [multi-file.project.json](../../examples/multi-file.project.json)。

在“新建项目”中选择“项目”，或直接导入教师 JSON。点击文件树中的 LPMake.txt 可编辑文本；实验选择框中的“构建设置…”提供对应表单，应用后写入同一个编辑缓冲。

## 2. 基本语法
声明由命令名、括号和字符串组成：

~~~text
# 整行注释
-- 也可使用 Lua 风格注释
--[[ 跨行
注释 ]]
target('app'); # 行尾注释；分号可省略

add_files(
    "./main.c",
    './helper.c', -- 参数后的注释
)
~~~

- #、-- 在字符串外开始行注释，--[[...]] 表示块注释；字符串内仍是普通字符。
- 英文逗号分隔参数，允许尾随逗号；空行与换行用于排版，可选分号分隔声明。
- 支持单双引号，常用转义为反斜杠、换行、Tab、Unicode 和对应引号；没有字符串插值或表达式求值。
- 命令名和参数值区分大小写；未知命令、重复单值声明及错误参数报告行列。
- 不执行变量赋值、循环、条件块、函数定义或构建钩子。
- LPMake 不进入 C/C++ 格式化器，编辑器提供高亮、注释、缩进和命令补全。

这些内容有不同含义：

~~~text
add_defines("LABEL=\"hello world\"") # 一个宏参数，值是 C 字符串
add_defines("TEXT=#inside")          # # 属于参数
add_files("src/*.c", "common/*.c")   # 两个文件模式
~~~

## 3. 14 条主命令速查
| 命令 | 参数 | 用途 |
| --- | --- | --- |
| target | 一个目标名，必填 | 定义唯一可执行目标 |
| set_language | "c" 或 "c++" | 显式覆盖源文件扩展名对应的语言 |
| set_standard | 一个标准名 | 设置 C 或 C++ 标准 |
| set_mode | "debug" 或 "release" | 设置基础构建模式 |
| set_optimize | "O0"、"O1"、"O2"、"O3"、"Os" | 覆盖优化级别 |
| add_files | 一个或多个路径/Glob | 添加参与编译的源文件 |
| remove_files | 一个或多个路径/Glob | 从最终源集合排除文件 |
| add_includedirs | 一个或多个目录 | 增加头文件搜索目录 |
| add_defines | 一个或多个宏 | 增加预处理宏定义 |
| add_linkdirs | 一个或多个目录 | 增加库搜索目录 |
| add_links | 一个或多个库名 | 按声明顺序链接库 |
| add_cflags | 一个或多个参数 | 追加 C 编译参数 |
| add_cxxflags | 一个或多个参数 | 追加 C++ 编译参数 |
| add_ldflags | 一个或多个参数 | 追加链接参数 |

所有命令至少有一个参数。target、set_language、set_mode、set_optimize 各最多声明一次。set_standard 的 C、C++ 两类标准各最多一条；其余命令可以重复，按声明顺序累计。

## 4. 目标、语言和标准
### target
~~~text
target("calculator")
~~~

目标名允许字母、数字、下划线和连字符，不包含路径或空白。一个实验项目只有一个可执行目标。平台需要的 .exe 后缀由 LabPad 处理，不写进目标名。

### set_language
不写时：

| 扩展名 | 编译语言 |
| --- | --- |
| .c | C |
| .cpp、.cc、.cxx | C++ |

写了 set_language 后，所有参与编译的源文件按指定语言处理：

~~~text
target("force_cpp")
set_language("c++")
set_standard("c++20")
add_files("src/*.c")
~~~

即使后缀是 .c，这里也按 C++20 编译，并使用 C++ 链接驱动。set_language("c") 同理可让 .cpp 按 C 编译。取值是 "c++"，不是 "cpp"。头文件通过 #include 使用，不加入 add_files。

### set_standard
~~~text
set_standard("c17")
set_standard("c++20")
~~~

两条可以共存，分别作用于 C 和 C++ 单元。同类重复声明会报错，例如同时写 c11 和 c17。

解析器识别：

| 语言 | 标准 |
| --- | --- |
| C | c89、c90、c99、c11、c17、c23 |
| GNU C | gnu89、gnu90、gnu99、gnu11、gnu17、gnu23 |
| C++ | c++98、c++03、c++11、c++14、c++17、c++20、c++23 |
| GNU C++ | gnu++98、gnu++03、gnu++11、gnu++14、gnu++17、gnu++20、gnu++23 |

具体标准还需所选编译器支持。未指定的语言槽使用固定缺省值 C17 / C++20，不从本机参数读取。兼容 cxx20 / gnuxx20 等拼写，解析后分别等同于 c++20 / gnu++20。

## 5. debug、release 和优化
~~~text
set_mode("debug")
set_optimize("O2")
~~~

| 设置 | 生效的基础参数 |
| --- | --- |
| 缺省或 debug | -g -O0 -UNDEBUG |
| release | -O2 -DNDEBUG |
| debug + set_optimize("O2") | 保留 -g，优化采用 -O2 |
| release + set_optimize("O0") | 保留 -DNDEBUG，优化采用 -O0 |

优化覆盖接受 O0 / O1 / O2 / O3 / Os，也支持下一节列出的 Xmake 常用别名。"debug" 是 set_mode 的取值，不是 set_optimize 的取值。

### Xmake 常用声明兼容

| 写法 | LPMake 含义 |
| --- | --- |
| set_languages("c17", "cxx20") | 分别设置 C17 / C++20，等同于两条 set_standard |
| add_cxflags("-Wall", "-Wextra") | 同时追加到 C 与 C++ 参数，保留每种语言中的声明顺序 |
| set_kind("binary") | 声明唯一可执行目标；也可以省略 |
| del_files("test/**.c") | remove_files 的兼容名称 |
| set_optimize("none" / "fast" / "faster" / "fastest" / "smallest") | 分别对应 O0 / O1 / O2 / O3 / Os |
| cxx11、cxx17、cxx20、gnuxx20 | 对应 c++11、c++17、c++20、gnu++20 |
| cxx1z、cxx2a、cxx2b | 对应 c++17、c++20、c++23 |

兼容声明与主命令共同校验，重复设置同一语言标准仍会报错。表单没有改动语义时保留原写法；修改某种语言参数时，会按需展开共享声明，保留另一语言的参数及注释。

LPMake 采用 Xmake 的部分声明写法，[Xmake 目标描述文档](https://xmake.io/api/description/project-target.html)可用于对照。LPMake 只构建一个可执行文件，static/shared 目标、Lua 条件、包管理与任意钩子不在此语言中。set_warnings、set_symbols 会提示相应的显式参数写法。

## 6. 文件、Glob 和路径
~~~text
add_files("src/*.c", "common/helper.c")
add_files("modules/**/*.cpp")
remove_files("src/experimental_*.c", "modules/tests/**")
~~~

- * 只匹配当前目录层级；** 递归子目录。./*.c 匹配根目录 C 文件，./**.c 与 ./**/*.c 等价，src/**.c 与 src/**/*.c 等价。
- 显式路径可以直接列举，例如 add_files("src/main.c", "src/stack.c")。
- 最终源集合是所有 add_files 的并集，再减去全部 remove_files；排除优先，与声明先后无关。
- 重复源文件只编译一次，按规范化相对路径稳定排序。
- 显式列出的文件必须存在；整个有效源集合为空时不能构建。
- 新增文件匹配 Glob 后自动参与构建，无需修改 LPMake。
- 当前源码未匹配或被排除时，编辑区会显示“当前源码未参与构建”。
- 使用 / 相对项目根目录，不使用绝对路径、.. 或越界链接。跨平台文件名及目录大小写保持一致。

包含目录和库目录必须存在。项目根目录可以写为 "." 或 "./"，两者等价；模板默认使用 "./"：

~~~text
add_includedirs("./", "include", "modules/include")
add_linkdirs("lib")
~~~

常用过滤示例：

~~~text
add_files("./*.{c,cpp}")              # 根目录两种扩展名
add_files("src/**.c|test.c|test/**.c") # 排除相对 src 的 test.c 与 test 子树
remove_files("src/experimental_*.c")
~~~

管道后的过滤模式相对于包含模式的基础目录。add_files 和 remove_files 使用同一匹配器。与 Xmake 按操作顺序增删的行为不同，LPMake 最终统一排除，后写 add_files 不会重新加入已排除的文件。默认不匹配以点开头的隐藏文件，显式名称仍可选中。

路径字段接受 $(projectdir) 作为根目录，例如 $(projectdir)/include；原始参数中也会替换该标记，字面量标记写成 $$(projectdir)。它是固定的根路径标记，不读取环境变量。

包含目录按声明顺序去重，搜索顺序保留。源文件排序不会改变头文件或库的搜索次序。文件树重命名时，可以同步修改 LPMake 中对应的显式路径；Glob 通常无需改写。

## 7. 宏定义
~~~text
add_defines("MAX_BUF=4096", "USE_FAST_MATH")
add_defines("MESSAGE=\"hello world\"")
~~~

宏名使用 ASCII 字母、数字、下划线，首字符不能是数字。值可以包含空格和引号。每个字符串作为一个独立参数传给编译器，不经过 shell 拆分。

以下写法会报错：

~~~text
add_defines(" USE_FAST_MATH") # 宏名前多了空格
add_defines("3D_MODE")        # 宏名以数字开头
~~~

## 8. 库和原始参数
~~~text
add_links("m")
add_cflags("-Wall", "-Wextra")
add_cxxflags("-Wall", "-Wextra")
add_ldflags("-pthread")
~~~

add_links("m") 声明数学库：GNU 目标使用 -lm；MSVC 目标的数学函数已由 C 运行库提供，LabPad 省略独立 -lm。显式 add_ldflags("-lm") 则按原参数执行。库和原始参数保留声明顺序及重复项，不能按字母排序；依赖库通常放在使用它的对象/库之后。

每个原始参数单独写一个字符串：

~~~text
add_cflags("-Wall", "-Wextra") # 两个参数
~~~

不要把两个参数合并为 "-Wall -Wextra"。需要“选项 + 值”时同样拆开，例如 add_cflags("-include", "include/config.h")。源码、有效语言和输出位置由 LabPad 安排。

线程示例，适用于工具链提供 pthread 的课程环境：

~~~text
add_cflags("-pthread")
add_cxxflags("-pthread")
add_ldflags("-pthread")
~~~

只写 add_links("pthread") 不能替代编译阶段的线程选项。额外库仍需在所选工具链环境中安装；LPMake 不下载依赖。当前项目 JSON 和编辑工作区面向文本文件，二进制第三方库不作为源码字符串下发。各平台支持的库及原始选项以实际编译器为准。

## 9. 参数优先级
每个编译单元按以下顺序合成参数，后面的同类选项可以覆盖前面的选项：

1. 对应语言的 set_standard，省略则为 C17 / C++20。
2. set_mode 的基础模式。
3. set_optimize。
4. add_includedirs 和 add_defines。
5. 对应的 add_cflags 或 add_cxxflags（含 add_cxflags）。
6. 程序安排的有效语言、源码和对象位置。

例如：

~~~text
target("priority")
set_standard("c17")
set_mode("debug")
set_optimize("O3")
add_cflags("-O0")
add_files("src/*.c")
~~~

这里按 C17 编译，最终优化为 O0，保留 Debug 调试符号。本机全局参数不参与合成。链接时先放入本次对象，再按 LPMake 的库目录、库和额外链接参数顺序处理。

展开“查看生效参数”，可以按来源核对每一步追加的参数。标准或优化被后续额外参数覆盖时，字段旁显示提示；目录和库仍按原次序累加。

## 10. C++ 项目
~~~text
target("hello_cpp")
set_standard("c++20")
add_files("src/*.cpp")
~~~

src/main.cpp：

~~~cpp
#include <iostream>
#include <string>

int main() {
    std::string message = "hello";
    std::cout << message << '\n';
}
~~~

## 11. C/C++ 混合项目
~~~text
target("mixed")
set_standard("c17")
set_standard("c++20")
add_includedirs("include")
add_files("src/*.c", "src/*.cpp")
~~~

include/calc.h：

~~~c
#ifndef CALC_H
#define CALC_H
#ifdef __cplusplus
extern "C" {
#endif
int twice(int value);
#ifdef __cplusplus
}
#endif
#endif
~~~

src/calc.c：

~~~c
#include "calc.h"
int twice(int value) { return value * 2; }
~~~

src/main.cpp：

~~~cpp
#include <iostream>
#include <string>
#include "calc.h"

int main() {
    std::string label = "result";
    std::cout << label << ": " << twice(21) << '\n';
}
~~~

.c 使用 C17，.cpp 使用 C++20。存在有效的 C++ 单元时，LabPad 选择 C++ 链接驱动和标准库；C 接口通过 extern "C" 与 C++ 调用方衔接。

## 12. 编辑、保存、运行和导出
LPMake 文本和构建表单共享缓冲。表单应用会保留注释，整次改动可撤销。F9 / Ctrl+Enter 执行编译。源码、头文件或 LPMake 有未保存修改时，可选择“保存并编译”或取消；保存失败会停止编译。测试点在编译成功后单独运行，沿用当前程序。解析失败时先修复、保存，再编译。

Zig 直接通过 zig cc / zig c++ 构建并复用受控缓存；GCC/Clang 采用有界并行编译后一次链接。重复运行可能命中 Zig 缓存，首次标准库或模式准备仍可能较慢。

导出整个项目时，LPMake 与源码一起提供：

~~~text
提交名称.zip
└─ 提交名称/
   ├─ LPMake.txt
   ├─ include/
   │  └─ calc.h
   └─ src/
      ├─ main.cpp
      └─ calc.c
~~~

只命名 ZIP 和同名外层文件夹，内部源码、头文件和 LPMake 保持原名。“附带 LabPad 项目配置”另行控制测试点及重建信息。

## 13. 常见错误
| 提示或现象 | 检查与处理 |
| --- | --- |
| Unexpected token / Unexpected end of file | 检查英文括号、双引号、逗号及未闭合字符串 |
| Unknown command | 对照命令表；add_includedirs 中间没有空格 |
| 重复声明 standard:c | 保留一条 C 标准；C++ 标准可另写一条 |
| No source files remain in the build | 检查 add_files、扩展名、Glob 层级与 remove_files |
| Source file ... does not exist | 修正显式路径或同步重命名引用 |
| 包含/库目录不在项目内 | 使用存在的项目内相对目录 |
| 找不到头文件 | 检查 #include 名称、目录大小写和 add_includedirs |
| 多次定义 main | 多文件模式只保留一个 main，排除独立试验入口 |
| 未定义符号 | 检查实现文件是否参与构建、C/C++ 接口和库次序 |
| 修改源码后输出没变 | 查看“未参与构建”提示及输出中的实际编译单元 |
| 保存后格式不变 | LPMake 不使用 clang-format；可通过构建设置调整声明 |

完整实验操作见[学生指南](student-guide.md)，项目下发和批测见[助教指南](ta-guide.md)，实现及验证见[技术说明](maintainer-guide.md)。

## 诊断格式
LPMake 诊断使用英文，给出文件、行列、源码及定位指针。已识别的修正建议显示为 hint，相关上下文显示为 note；两者按需出现。

~~~text
LPMake.txt:2:14: error: Unsupported language "cpp".
  2 | set_language("cpp")
    |              ^~~~~
  hint: Use set_language("c") or set_language("c++").
  note: Omit set_language() to infer the language from each source extension.
~~~

修正上例中的 cpp 为 c++ 后重新运行。缺失文件、目录、未匹配源文件及重复声明也会定位到对应配置；源码中的 Tab 在诊断显示中展开为 4 个空格。

## 构建设置、参数诊断与保存

展开实验选择框后，底部的“构建设置…”打开当前实验配置；也可右键选择框或实验列表项。

项目表单打开 LPMake 标签，基础字段和“高级”字段对应同一份文本。应用后有文本变化就显示未保存，保存该标签或保存全部才写入文件。预览可查看草稿参数，实际编译读取已保存文件。普通源码的保存只更新该源码。撤销和放弃按编辑器文件操作处理。

新建项目使用固定默认模板，不复制个人全局参数：

~~~text
target("app")
set_standard("c17")
set_standard("c++20")
set_mode("debug")
add_includedirs("./")
add_files("./*.c", "./*.cpp")
add_cflags("-Wall", "-Wextra", "-Wshadow", "-Wconversion", "-Wundef", "-Wformat=2")
add_cxxflags("-Wall", "-Wextra", "-Wshadow", "-Wconversion", "-Wundef", "-Wformat=2")
add_links("m")
~~~

导入课程项目缺少 LPMake 时，会填入同一模板并提示修改配置或忽略，保留原源码布局。根目录模式不会自动匹配 src；应按目录调整源码范围。老师提供了 LPMake 时原样采用，语法有错会报错，不用默认模板替换。

默认警告帮助发现遮蔽、类型缩窄、未定义宏及格式串问题，不启用 -Werror；提示含义见[学生指南](student-guide.md#看懂编译警告)。

### 参数边界与错误

每个字符串代表一个进程参数。例如：

~~~text
add_cflags("-Iinclude", "-include", "config.h", "-DMSG=hello world")
~~~

-include 与 config.h 是两个参数；-DMSG=hello world 是一个完整参数。不会按空格自动拆成 shell 命令。

独立 -o / --output、-c / -S / -E、-M / -MM，以及独立 -x / --language 和明确的 -xc / -xc++ / -xnone，会与 LabPad 管理的构建流程冲突，应移除；项目语言用 set_language 设置。已识别的有值选项位于列表末尾时，会指出缺少下一项。

这些检查按选项边界处理，不按无例外前缀匹配。-MD / -MMD 可在正常编译时附带依赖信息，不等同于只输出依赖；Clang 的 -object-file-name 也作为独立选项保留。其他工具链是否支持该选项，由编译器给出原始诊断。

直接编辑 LPMake 可以保存原文；构建时校验配置。错误继续使用英文行列、源码、指针及按需 hint / note 的格式；表单中的操作说明使用中文。

### 覆盖与编译/链接提示

原始参数最后加入。例如 set_standard("c17") 后又设置 add_cflags("-std=c11")，实际请求 C11；set_mode("debug") 后设置 -g0，会关闭调试符号。

多文件项目编译与链接分开执行，-pthread、部分插桩开关通常需要同时用于链接。配对检查会核对本次真正采用的额外参数及显式库，兼容 coverage 的显式运行库和 sanitizer 列表的合写/分写。明确的关闭选项也参与判断；提示允许继续，不会自动复制参数。

GCC 可从 LTO 对象自动启用链接优化，因此缺少同名 -flto 不直接判为漏配。具体语言标准、运行库和链接器能力以所选编译器为准。

相对 -I 目录建议改用 add_includedirs，相对 -L 目录建议改用 add_linkdirs。-include 指定强制包含的文件，语义与包含目录不同，仍留在额外参数。预览中展示编译、链接的工作目录，原始相对参数保持原来的解析规则。



## 终端构建与产物

APP 下方“终端”支持以下命令，命令名大小写兼容：

~~~text
lpmake build
lpmake b
lpmake run
lpmake r
lpmake clean
lpmake c
~~~

终端根目录提示符为 >，进入子目录后显示相对路径，例如 src/tests>。

只读取**当前目录的 LPMake.txt**。cd 到子目录后，若那里没有配置，提示“当前目录未找到 LPMake.txt”；不会使用父级配置。嵌套目录各自有配置时，分别构建，不自动修改父配置的源码范围。

build 读取已保存文件，将程序、对象与辅助文件写到当前配置目录的 build/。已有用户 build/ 无归属清单时需先移走或重命名。run 使用该配置当前有效的程序，修改源码、头文件、资源或配置后先重新 build。clean 只删除该配置清单中的产物，保留用户文件。

GUI“编译”、测试点与断点调试继续使用临时目录及受控缓存，不在实验内生成 build/。两条入口共用解析和编译核心，各自维护程序有效性。新建、复制、导出与 CLI 收件会排除识别到的构建产物。子目录配置不自动从父配置 Glob 中排除源码；源码范围由各自 add_files / remove_files 决定。

LPMake 不执行任意脚本，不提供终端外的独立系统命令；外部批测继续使用 LabPad CLI。


## 编辑器中的有效语言

set_language("c++") 会让匹配到的 .c 文件按 C++ 编译，并使用 C++ 关键词与基础补全；set_language("c") 对 .cpp 同样生效。未指定时按文件扩展名选择语言。查看或编辑 LPMake.txt 时仍构建整个项目，配置文件本身不交给 C/C++ 格式化器。

## 构建预览与文件大小

“构建设置…”中的参数变化后，旧的“查看生效参数”立即失效，短暂等待后显示当前配置。应用与保存仍遵循同一份 LPMake.txt 文本。

编辑器单文件上限为 8 MiB；项目解压后同样按单文件 8 MiB、合计 64 MiB 检查。大型生成数据应通过文件管理器查看，并在打包前整理。
