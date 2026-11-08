# 错误输出示例

面向版本：1.0.0-rc.1。核验日期：2026-11-09。以下内容来自 Linux 原生候选实际运行。

## LPMake 配置检查

set_language("cpp") 的参数写法错误。桌面端切换到“输出”，显示以下内容；编译、开始调试、终端构建和项目导入使用相同排版。

```text
LPMake 配置检查

LPMake.txt:2:14: error: Unsupported language "cpp".
  2 | set_language("cpp")
    |              ^~~~~
  hint: Use set_language("c") or set_language("c++").
  note: Omit set_language() to infer the language from each source extension.
```

hint 与 note 分别按识别到的修正建议和上下文显示。语法不完整时，示例只有 hint：

```text
LPMake 配置检查

LPMake.txt:1:13: error: Unexpected end of file.
  1 | target("app"
    |             ^
  hint: Use command("value", "value") syntax. Check quotes, commas and parentheses.
```

## C 编译器诊断

修正 LPMake 后，源码引用了未声明的 unknown_symbol。以下是“输出”中的完整编译命令、stderr 和状态；路径属于本次测试的临时构建目录。

```text
编译命令
/usr/bin/gcc -std=c17 -g -O0 -UNDEBUG -x c -c /tmp/labpad-compiler-cache-1000/projects/79bb1c52c5a2c573114e114c/snapshot/main.c -o /tmp/labpad-compiler-cache-1000/projects/79bb1c52c5a2c573114e114c/obj/main.c.o

stderr
[main.c]
/tmp/labpad-compiler-cache-1000/projects/79bb1c52c5a2c573114e114c/snapshot/main.c: In function ‘main’:
/tmp/labpad-compiler-cache-1000/projects/79bb1c52c5a2c573114e114c/snapshot/main.c:1:25: error: ‘unknown_symbol’ undeclared (first use in this function)
    1 | int main(void) { return unknown_symbol; }
      |                         ^~~~~~~~~~~~~~
/tmp/labpad-compiler-cache-1000/projects/79bb1c52c5a2c573114e114c/snapshot/main.c:1:25: note: each undeclared identifier is reported only once for each function it appears in


编译状态：CE · 51 ms
```

将源码修正为 int main(void) { return 0; }，保存并重新编译，状态恢复为 success。
