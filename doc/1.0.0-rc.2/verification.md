# LabPad v1.0.0-rc.2 验证记录

核验日期为 2026 年 11 月 21 日。Windows x64 与 Linux x64 使用 rc.2 候选源码的原生桌面构建。

## Windows x64 与 Linux x64

| 场景 | Windows x64 | Linux x64 |
| --- | --- | --- |
| 构建 | 桌面构建通过 | 桌面与 CLI 构建通过 |
| rc.2 桌面回归 | 5 组通过，题集使用随包 Zig | 5 组通过，题集使用系统 GCC |
| 代码补全 | 编辑 `return fun();` 时保留 `fun()`，语句模板按顺序展示并在明确选中后展开 | 同左 |
| 题集构型与断点 | C/C++ 的 Debug / Release 编译与自测、Release 的三个调试选择、断点与单步。C 另验条件断点、取消重启与保存并重启 | 同左 |
| 紧凑布局 | 640px 下中英文工具栏保持单行，构型菜单可操作，多文件项目隐藏该菜单 | 同左 |
| 实验导入 | 文件夹导入覆盖根目录、含系统杂项的单层外目录、错误目录与取消。原生文件选择器实测全部实验项目、ZIP、JSON 三种筛选 | 文件夹导入覆盖相同流程 |
| 核心套件 | 196 项中 160 通过、34 项基线失败、2 跳过 | 196 项全部通过，含 Bubblewrap 测试 |

Windows 补测 WinLibs GCC 14.2.0 与 Clang 19.1.7。两套工具链分别通过 C 与 C++ 流程，共 4 组。实测命令分别使用 `-O0` 和 `-O2`，可查看暂停处的变量，调试结束后可继续使用已有普通构型的产物。测试将 WinLibs 安装在纯 ASCII 路径。该版 WinLibs 解压至含中文的安装路径时，原生命令行也复现了 CRT 链接失败。

## Windows 核心套件基线

在同一 Windows 环境先构建再分别运行 rc.1 基线 `dd2c44e` 和 rc.2。rc.1 为 154 通过、34 失败、2 跳过。两轮失败名单及原因一致，rc.2 新增的 6 项测试均通过。34 项均与本轮补全、题集构型调试或文件夹导入无关。

| 测试前提 | 数量 | 典型表现 |
| --- | ---: | --- |
| GCC/G++ 路径 | 19 | 固定使用 `/usr/bin/gcc`，或依赖测试进程的 `PATH` 查找 `gcc` / `g++` |
| Linux 工具链或 checker 路径 | 11 | 测试固定使用 `.work/toolchains/linux-x64` 或 `.work/checkers/linux-x64` |
| POSIX 权限故障注入 | 2 | `chmod(0500)` 在 Windows 上未触发用例预期的写入拒绝 |
| POSIX 工具链探针夹具 | 2 | shell 假编译器及符号链接不满足 Windows 测试环境的运行条件 |

## Lab 1–4 回归

用同一批 19 份已保存的 C 参考答案和原有测试点，分别在 Windows x64 与 Linux x64 的原生桌面构建中使用随包 Zig 编译与送测。每个平台的 Debug、Release 各编译 19 份，均通过以下 76 个测试点。

| 实验 | 源码份数 | 每轮通过测试点 |
| --- | ---: | ---: |
| 实验1 | 3 | 5/5 |
| 实验2 | 8 | 22/22 |
| 实验3 | 4 | 21/21 |
| 实验4 | 4 | 28/28 |
| 合计 | 19 | 76/76 |

Lab 3-3 单独通过每端 10 项终端互动检查。用数据副本中的固定答案覆盖猜大、猜小、第七次猜中、失败揭晓、续玩和退出，再恢复并核对原始源码，重新编译随机版本，实玩两轮。

## 发布归档

在 `main` 快进合并至 `66efe8396252196e9d37ed8bf5c067fc0608218d` 后，从该提交构建三平台桌面包与 Linux CLI 包。

| 归档 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `LabPad-1.0.0-rc.2-win-x64.zip` | 309,528,970 | 通过 |
| `LabPad-1.0.0-rc.2-linux-x64.tar.gz` | 261,201,335 | 通过 |
| `LabPad-1.0.0-rc.2-mac-arm64.zip` | 251,137,920 | 通过 |
| `LabPad-1.0.0-rc.2-cli-linux-x64.tar.gz` | 5,077,190 | 通过 |

`SHA256SUMS.txt` 包含这四份归档的摘要，`sha256sum --check --strict SHA256SUMS.txt` 全部返回 `OK`。两个 ZIP 均通过 CRC 校验，macOS ZIP 保留框架的符号链接。Windows 和 Linux 从成品归档解压运行，使用随包 Zig 复测补全、C/C++ 构型调试、紧凑布局及文件夹导入，各通过 5 组。Linux CLI 求和用例 2/2 通过。

## macOS arm64 归档核验

在 Linux 上交叉构建，使用 rcodesign 0.29.0 完成 ad-hoc 签名，未公证。重新解压成品 ZIP 后核对 `LabPad.app` 的版本、应用标识，以及主程序、Electron、Zig、CodeLLDB、checker 和 node-pty 的 arm64 二进制。

- **签名与代码页**。核对 29 个 Mach-O 的签名标志，重算 136,409 个代码页哈希并逐项比对 CodeDirectory。主程序 CDHash 为 `a77f457f8dec310280106b8630435c0f6ca0611c`。
- **资源封签**。核对 9 个 Bundle 的 CodeDirectory 与 Info.plist、CodeResources 之间的哈希绑定，再校验 4,713 个资源文件摘要与 10 个嵌套代码 CDHash。[Apple CodeDirectory 哈希说明](https://developer.apple.com/documentation/technotes/tn3126-inside-code-signing-hashes)

## macOS arm64 待实机验证

- 启动、随包 Zig 编译与自测，以及 CodeLLDB 的断点、单步、重启和退出。
- 原生 ZIP / JSON 选择器、实验文件夹导入、640px 工具栏和补全的键盘操作。
- Lab 1–4 回归及终端输入、程序输出与退出。

## 合并检查

- [x] 补全采用方案 A，clangd 探针数据归档。
- [x] 核对 Windows 基线失败与两套 WinLibs 工具链，完成 Windows / Linux 原生回归。
- [x] 核对 rc.2 版本标识、README、三份指南、更新说明与平台记录。
- [x] 核对 `main` 与候选提交的差异并完成快进合并。
- [x] 从合并提交生成桌面与 CLI 归档，核对 macOS 签名与资源，生成并验过 `SHA256SUMS.txt`。
