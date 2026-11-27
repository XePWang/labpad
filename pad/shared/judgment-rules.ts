import type { Comparison, Problem, TestCase } from './types';

export function expectedOutputForJudgment(test: TestCase, comparison: Comparison) {
  return (test.comparison ?? comparison).type === 'automaton' ? null : test.expectedOutput;
}

export function judgmentRules(problem: Problem) {
  return [
    problem.labId,
    problem.problemId,
    problem.timeLimitMs,
    problem.outputLimitBytes,
    problem.comparison,
    problem.testCases.map((test) => [
      test.id,
      test.input,
      expectedOutputForJudgment(test, problem.comparison),
      test.comparison ?? problem.comparison,
    ]),
  ];
}
