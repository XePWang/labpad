# LabPad v1.0.0-rc.3 开发记录

更新于 2026 年 11 月 27 日。

## 新增

- 自动机比较规则支持逐行模板与 JSON 状态表。模板可组合多个字段，支持内置 `positiveInteger`、`seconds3` 和自定义 RE2 正则。
- 自动机测试点显示「格式样例」。WA 时显示首个失败行、状态与执行轨迹，CLI 报告使用同一诊断。
- 提供 Lab 5-2、5-3 的计时格式测试点与题集补丁。堆排序标签兼容 `heapSort` 和 `heapsort`。

[学生指南](student-guide.md) · [助教指南](ta-guide.md) · [规则与技术说明](maintainer-guide.md) · [验证记录](verification.md)
