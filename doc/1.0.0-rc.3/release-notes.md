# LabPad v1.0.0-rc.3 更新说明

更新于 2026 年 11 月 27 日。

## 新增

- 新增 `automaton` 比较模式。逐行模板可组合多个内置字段与自定义正则，JSON 状态表支持接收状态继续匹配，在输出结束时按当前状态判定。RE2JS 以线性时间执行正则匹配，匹配受预算与输出限额约束。
- 自动机测试点显示「格式样例」。WA 时显示首个失败行号、状态、期望和执行轨迹。`labpad judge` 与 `labpad grade` 使用同一判题内核并输出诊断摘要。
- 提供 Lab 5-2、5-3 的计时格式测试点与题集补丁。堆排序标签兼容 `heapSort` 和 `heapsort`。

## 修改

- 修复仅保存格式样例时触发源码格式化、导致已有 AC 失效的问题。
- 超长输出使用限长预览，`cases.csv` 的诊断限长并转义引号与公式。归档内附 RE2JS 的完整 MIT 许可。

本次提供 Windows x64、Linux x64 桌面包及 Linux x64 CLI，均已完成全量回归与归档校验。macOS arm64 待实机验证，本次无归档。

[学生指南](student-guide.md) · [助教指南](ta-guide.md) · [规则与技术说明](maintainer-guide.md) · [验证记录](verification.md)
