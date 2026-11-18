import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function globToRe(glob) {
  const escaped = glob.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  const re = escaped.replace(/\*\*/g, '\u00a7\u00a7').replace(/\*/g, '[^/]*').replace(/\u00a7\u00a7/g, '.*');
  return new RegExp(`^${re}$`);
}

export function check(project, mandate, task, now = Date.now()) {
  const reasons = [];
  const kill = join(resolve(project), '.kilo', 'agent-kill');
  if (existsSync(kill)) reasons.push('kill switch ativo');
  if (mandate.revoked === true) reasons.push('mandato revogado');
  const issued = Date.parse(mandate.issuedAt ?? '');
  const expires = Date.parse(mandate.expiresAt ?? '');
  if (!Number.isFinite(expires)) reasons.push('expiresAt inválido');
  else if (expires <= now) reasons.push('mandato expirado');
  if (Number.isFinite(issued) && issued > now) reasons.push('mandato ainda não válido');

  const budget = mandate.budget ?? {};
  const files = Array.isArray(task.files) ? task.files : [];
  if (files.length === 0) reasons.push('task sem arquivos');
  if (!Number.isFinite(budget.maxFiles) || files.length > budget.maxFiles) reasons.push('orçamento de arquivos excedido');
  if (!Number.isFinite(task.estimatedTokens) || !Number.isFinite(budget.maxTokens) || task.estimatedTokens > budget.maxTokens) {
    reasons.push('orçamento de tokens excedido');
  }
  const scope = Array.isArray(mandate.scope) ? mandate.scope : [];
  const patterns = scope.map(globToRe);
  for (const file of files) {
    if (!patterns.some((pattern) => pattern.test(file))) reasons.push(`fora do escopo: ${file}`);
  }
  const allowed = new Set(Array.isArray(mandate.allowedCommands) ? mandate.allowedCommands : []);
  const commands = Array.isArray(task.commands) ? task.commands : [];
  for (const command of commands) {
    if (!allowed.has(command)) reasons.push(`comando não permitido: ${command}`);
  }
  if (task.startedAt) {
    const started = Date.parse(task.startedAt);
    if (!Number.isFinite(started)) reasons.push('startedAt inválido');
    else if ((now - started) / 60_000 > (budget.maxMinutes ?? 0)) reasons.push('orçamento de tempo excedido');
  }
  return { ok: reasons.length === 0, reasons };
}

export function audit(project, entry) {
  const dir = join(resolve(project), '.kilo');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'agent-audit.ndjson'), `${JSON.stringify(entry)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'mandate-'));
  const mandate = {
    agentId: 'fixture',
    scope: ['src/**', 'tests/**'],
    budget: { maxFiles: 2, maxTokens: 1000, maxMinutes: 10 },
    allowedCommands: ['node --test'],
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2027-12-31T23:59:59Z',
    revoked: false,
  };
  const task = { id: 't1', files: ['src/a.js'], estimatedTokens: 100, commands: ['node --test'] };
  const now = Date.parse('2026-11-18T12:00:00Z');
  const allow = check(tmp, mandate, task, now);
  const revoked = check(tmp, { ...mandate, revoked: true }, task, now);
  const expired = check(tmp, { ...mandate, expiresAt: '2020-01-01T00:00:00Z' }, task, now);
  const scope = check(tmp, mandate, { ...task, files: ['secrets/key'] }, now);
  const files = check(tmp, mandate, { ...task, files: ['src/a.js', 'src/b.js', 'src/c.js'] }, now);
  const tokens = check(tmp, mandate, { ...task, estimatedTokens: 5000 }, now);
  const command = check(tmp, mandate, { ...task, commands: ['rm -rf /'] }, now);
  const time = check(tmp, mandate, { ...task, startedAt: '2026-11-18T11:00:00Z' }, now);
  mkdirSync(join(tmp, '.kilo'), { recursive: true });
  writeFileSync(join(tmp, '.kilo', 'agent-kill'), 'stop\n');
  const killed = check(tmp, mandate, task, now);
  audit(tmp, { at: new Date(now).toISOString(), taskId: task.id, decision: 'ALLOW' });
  const audited = existsSync(join(tmp, '.kilo', 'agent-audit.ndjson'));
  rmSync(tmp, { recursive: true, force: true });
  const ok = allow.ok && !revoked.ok && !expired.ok && !scope.ok && !files.ok
    && !tokens.ok && !command.ok && !time.ok && !killed.ok && audited;
  process.stdout.write(`mandate: SELF-TEST ${ok ? 'PASS' : 'FAIL'}\n`);
  return ok ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const value = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const project = resolve(value('--project', process.cwd()));
  const mandatePath = resolve(project, value('--mandate', 'agent/mandate.json'));
  const taskPath = resolve(project, value('--task', 'agent/task.json'));
  let mandate;
  let task;
  try {
    mandate = readJson(mandatePath);
    task = readJson(taskPath);
  } catch (error) {
    process.stdout.write(`mandate: DENY — ${error.message}\n`);
    return 1;
  }
  const result = check(project, mandate, task);
  audit(project, {
    at: new Date().toISOString(),
    agentId: mandate.agentId ?? 'unknown',
    taskId: task.id ?? 'unknown',
    decision: result.ok ? 'ALLOW' : 'DENY',
    reasons: result.reasons,
  });
  if (result.ok) {
    process.stdout.write(`mandate: ALLOW — ${mandate.agentId} · ${task.id}\n`);
    return 0;
  }
  process.stdout.write(`mandate: DENY — ${result.reasons.join('; ')}\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
