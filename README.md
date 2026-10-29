# labpad

A self-contained desktop judge and packager for C programming labs, featuring a bundled compiler, I/O diffing, and UTF-8 submission archiving.

内置编译器的 C 语言实验本地自查与打包桌面工具，支持单文件构建、标准输入输出比对与 UTF-8 规范归档。

## 文件结构

项目遵循规范化的目录分层结构，所有中间临时输出与沙箱工作区统一汇聚于 `.work/`。

项目源码放置于 `pad/`