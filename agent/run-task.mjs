import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, check } from '../tools/agent/mandate-guard.mjs';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const project = resolve(value('--project', process.cwd()));
const mandate = JSON.parse(readFileSync(join(project, value('--mandate', 'agent/mandate.json')), 'utf8'));
const task = JSON.parse(readFileSync(join(project, value('--task', 'agent/task.json')), 'utf8'));
const result = check(project, mandate, task);
audit(project, {
  at: new Date().toISOString(),
  agentId: mandate.agentId ?? 'unknown',
  taskId: task.id ?? 'unknown',
  decision: result.ok ? 'ALLOW' : 'DENY',
  reasons: result.reasons,
});

if (!result.ok) {
  process.stdout.write(`run-task: DENY — ${result.reasons.join('; ')}\n`);
  process.exit(1);
}

for (const command of task.commands ?? []) {
  const [bin, ...rest] = command.split(/\s+/);
  const child = spawnSync(bin, rest, {
    cwd: project,
    stdio: 'inherit',
    timeout: (mandate.budget?.maxMinutes ?? 1) * 60_000,
  });
  if (child.error) {
    process.stdout.write(`run-task: ERROR — ${child.error.message}\n`);
    process.exit(1);
  }
  if (child.status !== 0) {
    process.stdout.write(`run-task: FAIL — ${command} (exit ${child.status})\n`);
    process.exit(child.status ?? 1);
  }
}

process.stdout.write(`run-task: PASS — ${mandate.agentId} executou ${task.commands.length} comando(s) sob mandato\n`);
