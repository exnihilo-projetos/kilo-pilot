import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MoneyError,
  addAmounts,
  assertNonNegative,
  formatBRL,
  parseAmount,
} from '../../src/money.js';

const normalize = (value) => String(value).replace(/\u00a0/g, ' ');

export function runTask(task) {
  switch (task.operation) {
    case 'parse':
      return parseAmount(task.input) === task.expected;
    case 'add':
      return addAmounts(...task.input) === task.expected;
    case 'format':
      return normalize(formatBRL(task.input)) === task.expected;
    case 'nonneg':
      try {
        assertNonNegative(task.input);
        return false;
      } catch (error) {
        return error instanceof MoneyError && error.code === task.expectedError;
      }
    default:
      return false;
  }
}

export function evaluate(project) {
  const root = resolve(project);
  const tasks = JSON.parse(readFileSync(join(root, 'evals', 'tasks.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(join(root, 'evals', 'baseline.json'), 'utf8'));
  const results = tasks.map((task) => ({ id: task.id, pass: runTask(task) }));
  const score = results.filter((result) => result.pass).length;
  const total = results.length;
  const ok = score >= baseline.score;
  const report = {
    status: ok ? 'PASS' : 'FAIL',
    score,
    total,
    baseline,
    tasks: results,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(root, 'evals', 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function selfTest() {
  const cases = [
    [runTask({ operation: 'parse', input: '12.34', expected: 1234 }), true],
    [runTask({ operation: 'parse', input: '12.34', expected: 999 }), false],
    [runTask({ operation: 'format', input: 1234, expected: 'R$ 12,34' }), true],
    [runTask({ operation: 'nonneg', input: -1, expectedError: 'NEGATIVE_AMOUNT' }), true],
    [runTask({ operation: 'nonneg', input: -1, expectedError: 'WRONG' }), false],
    [runTask({ operation: 'unknown' }), false],
  ];
  const ok = cases.every(([actual, expected]) => actual === expected);
  process.stdout.write(`eval: SELF-TEST ${ok ? 'PASS' : 'FAIL'}\n`);
  return ok ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const index = args.indexOf('--project');
  const project = index >= 0 ? args[index + 1] : process.cwd();
  const report = evaluate(project);
  process.stdout.write(`eval: ${report.status} — ${report.score}/${report.total} (baseline ${report.baseline.score})\n`);
  return report.status === 'PASS' ? 0 : 1;
}

process.exit(main());
