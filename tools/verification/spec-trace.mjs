import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const TAG_RE = /\[(AC-\d+)\]/g;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function validate(project) {
  const root = resolve(project);
  const contractPath = join(root, 'spec', 'contract.json');
  const problems = [];
  if (!existsSync(contractPath)) {
    return { ok: false, problems: ['spec/contract.json ausente'], acs: [], orphans: [], spec: null };
  }
  let contract;
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    return { ok: false, problems: [`contrato inválido: ${error.message}`], acs: [], orphans: [], spec: null };
  }
  if (!Array.isArray(contract.acs) || contract.acs.length === 0) {
    problems.push('contrato sem ACs');
  }
  const ids = new Set();
  for (const ac of contract.acs ?? []) {
    if (!/^AC-\d+$/.test(ac.id ?? '')) problems.push(`AC inválido: ${ac.id}`);
    if (ids.has(ac.id)) problems.push(`AC duplicado: ${ac.id}`);
    ids.add(ac.id);
  }
  const tests = walk(join(root, 'tests')).filter((file) => /\.(m?js|ts)$/.test(file));
  const found = new Map();
  for (const file of tests) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(TAG_RE)) {
      const id = match[1];
      if (!found.has(id)) found.set(id, new Set());
      found.get(id).add(file.replace(`${root}/`, ''));
    }
  }
  for (const id of ids) {
    if (!found.has(id)) problems.push(`AC sem teste: ${id}`);
  }
  const orphans = [...found.keys()].filter((id) => !ids.has(id));
  for (const id of orphans) problems.push(`tag órfã: ${id}`);
  return {
    ok: problems.length === 0,
    problems,
    spec: contract.spec ?? null,
    acs: [...ids].map((id) => ({ id, tests: [...(found.get(id) ?? [])] })),
    orphans,
  };
}

export function writeReport(project, result) {
  const out = join(resolve(project), 'docs', 'deliveries', 'spec-trace.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({
    spec: result.spec,
    ok: result.ok,
    acs: result.acs,
    orphans: result.orphans,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return out;
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'spec-trace-'));
  const contract = { spec: 'SPEC-X', acs: [{ id: 'AC-1' }, { id: 'AC-2' }] };
  mkdirSync(join(tmp, 'spec'), { recursive: true });
  mkdirSync(join(tmp, 'tests'), { recursive: true });
  writeFileSync(join(tmp, 'spec', 'contract.json'), JSON.stringify(contract));
  writeFileSync(join(tmp, 'tests', 'a.test.js'), "test('[AC-1] ok', () => {});\n");
  const missing = validate(tmp);
  writeFileSync(join(tmp, 'tests', 'b.test.js'), "test('[AC-2] ok', () => {});\n");
  const clean = validate(tmp);
  writeFileSync(join(tmp, 'tests', 'c.test.js'), "test('[AC-9] orphan', () => {});\n");
  const orphan = validate(tmp);
  rmSync(tmp, { recursive: true, force: true });
  const ok = missing.ok === false && clean.ok === true && orphan.ok === false
    && missing.problems.some((p) => p.includes('AC sem teste'))
    && orphan.problems.some((p) => p.includes('tag órfã'));
  process.stdout.write(`spec-trace: SELF-TEST ${ok ? 'PASS' : 'FAIL'}\n`);
  return ok ? 0 : 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const projectIndex = args.indexOf('--project');
  const project = projectIndex >= 0 ? args[projectIndex + 1] : process.cwd();
  const result = validate(project);
  for (const problem of result.problems) process.stderr.write(`spec-trace: ${problem}\n`);
  if (result.ok) {
    const out = writeReport(project, result);
    process.stdout.write(`spec-trace: PASS — ${result.acs.length} ACs rastreados (${out})\n`);
    return 0;
  }
  process.stdout.write(`spec-trace: FAIL — ${result.problems.length} problema(s)\n`);
  return 1;
}

process.exit(main());
