# LabPad rc.3 助教指南

适用版本为 v1.0.0-rc.3，更新于 2026 年 11 月 27 日。收件、版本择优与 CSV 用法见 [rc.2 助教指南](../1.0.0-rc.2/ta-guide.md)。

- 在 `project.json`、`.io.json` 或项目测试点补丁中使用 `comparison.type: "automaton"`。固定顺序的报告用 `template.lines`，需要可选行或循环时用 `machine`。模板字段可复用内置格式或填写 RE2 语法的正则。[规则格式与限额](maintainer-guide.md)
- Lab 5 的三份示例文件使用题内覆盖时限 120000 毫秒。它们按格式检查数据量、顺序和秒数字段。正式批测把 `testCases` 放入教师的项目配置或隐藏测试文件，继续通过 `grade.json` 确认权重。指导书规定的实验计分仍由课程执行。[题集补丁](../../examples/lab-5-timing.projectTests.json)
- 单点调试可运行 `labpad judge --source solution.c --tests lab-5-2-timing.io.json --json`。批量使用 `labpad grade <实验目录>`，`cases.csv` 的「说明」列写入首处失败信息。单次送测 JSON 可查看状态与最近转移。正式评分沿用助教目录的规则。
