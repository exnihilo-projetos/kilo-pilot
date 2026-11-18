import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const project = resolve(value('--project', process.cwd()));
const status = value('--status', 'PASS');
const checksRaw = value('--checks', '');
const contract = readJson(join(project, 'spec', 'contract.json'));
const trace = readJson(join(project, 'docs', 'deliveries', 'spec-trace.json'));
const evaluation = readJson(join(project, 'evals', 'report.json'));
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' });
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' });
const checks = checksRaw.trim().split(/\s+/).filter(Boolean).map((item) => {
  const [name, result] = item.split(':');
  return { name, status: result };
});
const manifest = {
  schema: 1,
  project: 'kilo-pilot',
  status,
  spec: contract?.spec ?? null,
  ac_count: trace?.acs?.length ?? 0,
  acs: trace?.acs ?? [],
  trace_ok: trace?.ok ?? false,
  eval: evaluation
    ? {
      status: evaluation.status,
      score: evaluation.score,
      total: evaluation.total,
      baseline: evaluation.baseline?.score ?? null,
    }
    : null,
  checks,
  generatedAt: new Date().toISOString(),
  git: {
    head: head.status === 0 ? head.stdout.trim() : null,
    dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : null,
  },
};
const out = join(project, 'docs', 'deliveries', 'kilo-pilot.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`manifest: ${status} — ${out}\n`);
process.exit(status === 'PASS' ? 0 : 1);
