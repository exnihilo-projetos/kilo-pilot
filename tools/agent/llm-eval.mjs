#!/usr/bin/env node
// llm-eval.mjs — harness de avaliação do agente LLM (golden set + grader determinístico + judge free).
//
// Modos:
//   node tools/agent/llm-eval.mjs --live   -> chama o modelo FREE (OmniRoute), grava fixtures, avalia
//   node tools/agent/llm-eval.mjs          -> offline/CI: reavalia fixtures gravadas (determinístico)
//   node tools/agent/llm-eval.mjs --self-test
//
// Honestidade de status:
//   PASS  = todos os graders determinísticos passaram e o número de passes >= baseline
//   FAIL  = algum grader falhou ou passes < baseline
//   SKIP  = nenhuma fixture disponível (live indisponível/esgotado) — NUNCA vira PASS falso
//   PASS_DETERMINISTIC = fixtures PASS, judge free indisponível (judge SKIP, advisory)
//
// Não toca evals/tasks.json, evals/baseline.json nem evals/report.json (eval money do KiloPilot).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_BASE = 'http://localhost:20128/v1';
const DEFAULT_MODEL = 'agy/gemini-3.8-flash-high'; // free (agy) e responde texto direto; override via LLM_EVAL_MODEL
const FREE_HINT = /quota|rate.?limit|429|401|403|exhaust|no available|invalid.?api.?key|insufficient/i;

function argValue(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function grade(task, response) {
  const text = normalize(response);
  const groups = (task.must ?? []).map((group, index) => {
    const terms = Array.isArray(group) ? group : [group];
    const hit = terms.find((term) => text.includes(normalize(term)));
    return { index, pass: Boolean(hit), hit: hit ?? null, terms };
  });
  const forbidden = (task.forbid ?? []).filter((term) => text.includes(normalize(term)));
  const words = String(response ?? '').trim().split(/\s+/).filter(Boolean).length;
  const maxWords = Number.isFinite(task.maxWords) ? task.maxWords : 120;
  const pass = groups.every((g) => g.pass) && forbidden.length === 0 && words > 0 && words <= maxWords;
  return { pass, groups, forbidden, words, maxWords, hardFail: forbidden.length > 0 || words > maxWords };
}

async function callFreeModel({ system, prompt, model, base, key, timeoutMs = 120000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system ?? '' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, status: res.status, error: `resposta não-JSON: ${raw.slice(0, 200)}` };
    }
    if (!res.ok || data.error) {
      return { ok: false, status: res.status, error: String(data.error?.message ?? data.error ?? raw).slice(0, 300) };
    }
    const content = data.choices?.[0]?.message?.content ?? '';
    return { ok: true, content, model: data.model ?? model, usage: data.usage ?? null };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

function judgePrompt(task, response) {
  return [
    'Avalie a resposta do agente abaixo. Retorne exatamente duas linhas:',
    'SCORE: <1-5>',
    'REASON: <uma frase>',
    '',
    `Rubrica: ${task.rubric ?? 'Correção técnica e concisão.'}`,
    '',
    `Tarefa: ${task.prompt}`,
    `Resposta: ${response}`,
  ].join('\n');
}

async function judge(task, response, cfg) {
  if (!response) return { status: 'SKIP', reason: 'sem resposta' };
  let out;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    out = await callFreeModel({
      system: 'Você é um avaliador rigoroso. Não elogie. Seja conciso.',
      prompt: judgePrompt(task, response),
      model: cfg.judgeModel,
      base: cfg.base,
      key: cfg.key,
    });
    if (out.ok && /SCORE\s*:\s*[1-5]/i.test(out.content ?? '')) break;
  }
  if (!out.ok) {
    return { status: FREE_HINT.test(out.error ?? '') ? 'SKIP' : 'ERROR', reason: out.error };
  }
  const score = Number((out.content.match(/SCORE\s*:\s*([1-5])/i) ?? [])[1] ?? NaN);
  const reason = (out.content.match(/REASON\s*:\s*(.+)/i) ?? [])[1]?.trim() ?? out.content.slice(0, 160);
  return Number.isFinite(score)
    ? { status: 'SCORED', score, reason, model: out.model }
    : { status: 'ERROR', reason: `score não parseado: ${out.content.slice(0, 120)}` };
}

function loadSuite(project) {
  return JSON.parse(readFileSync(join(project, 'evals', 'llm', 'tasks.json'), 'utf8'));
}

function fixturePath(project, id) {
  return join(project, 'evals', 'llm', 'fixtures', `${id}.json`);
}

function readFixture(project, id) {
  const file = fixturePath(project, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeReports(project, report) {
  const dir = process.env.LLM_EVAL_REPORT_DIR ? resolve(process.env.LLM_EVAL_REPORT_DIR) : join(project, 'evals', 'llm');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# LLM eval — ${report.status}`,
    '',
    `- suite: ${report.suite} v${report.version}`,
    `- modo: ${report.mode}`,
    `- modelo: ${report.model ?? 'n/a'}`,
    `- determinístico: ${report.deterministicPass}/${report.total} (baseline ${report.baseline.minDeterministicPass})`,
    `- judge: ${report.judgeStatus}`,
    `- gerado: ${report.generatedAt}`,
    '',
    '| tarefa | determinístico | judge | motivo |',
    '|---|---|---|---|',
    ...report.tasks.map((t) => `| ${t.id} | ${t.deterministic.pass ? 'PASS' : 'FAIL'} | ${t.judge.status}${Number.isFinite(t.judge.score) ? ` ${t.judge.score}/5` : ''} | ${(t.reason ?? '').replace(/\|/g, '/').slice(0, 120)} |`),
    '',
  ];
  writeFileSync(join(dir, 'report.md'), lines.join('\n'));
}

async function run(project, { live, model, judgeModel, base, key }) {
  const suite = loadSuite(project);
  const baseline = JSON.parse(readFileSync(join(project, 'evals', 'llm', 'baseline.json'), 'utf8'));
  const tasks = suite.tasks ?? [];
  const results = [];
  let unavailable = 0;
  for (const task of tasks) {
    let fixture = readFixture(project, task.id);
    if (live) {
      let out;
      let attempts = 0;
      do {
        out = await callFreeModel({ system: suite.system, prompt: task.prompt, model, base, key });
        attempts += 1;
      } while (attempts < 3 && out.ok && !String(out.content ?? '').trim());
      if (!out.ok || !String(out.content ?? '').trim()) {
        unavailable += 1;
        const reason = out.ok ? 'resposta vazia após 3 tentativas' : out.error;
        results.push({ id: task.id, deterministic: { pass: false, error: reason }, judge: { status: 'SKIP', reason }, reason });
        continue;
      }
      const j = await judge(task, out.content, { judgeModel, base, key });
      fixture = {
        schema: 1, taskId: task.id, model: out.model, usage: out.usage, attempts,
        generatedAt: new Date().toISOString(), prompt: task.prompt, response: out.content, judge: j,
      };
      mkdirSync(join(project, 'evals', 'llm', 'fixtures'), { recursive: true });
      writeFileSync(fixturePath(project, task.id), `${JSON.stringify(fixture, null, 2)}\n`);
    }
    if (!fixture) {
      results.push({ id: task.id, deterministic: { pass: false, missing: true }, judge: { status: 'SKIP', reason: 'fixture ausente (rode --live)' }, reason: 'fixture ausente' });
      continue;
    }
    const graded = grade(task, fixture.response);
    const j = fixture.judge ?? { status: 'SKIP', reason: 'não gravado' };
    const reason = graded.pass
      ? (j.status === 'SCORED' ? j.reason : 'determinístico OK')
      : [
          graded.forbidden.length ? `proibido: ${graded.forbidden.join(', ')}` : '',
          graded.words > graded.maxWords ? `longo: ${graded.words}>${graded.maxWords}` : '',
          graded.groups.filter((g) => !g.pass).map((g) => `faltou: ${g.terms.join('/')}`).join('; '),
        ].filter(Boolean).join(' | ');
    results.push({ id: task.id, deterministic: graded, judge: j, reason, fixtureModel: fixture.model });
  }
  const deterministicPass = results.filter((r) => r.deterministic.pass).length;
  const missing = results.filter((r) => r.deterministic.missing).length;
  const judgeScores = results.map((r) => r.judge?.score).filter(Number.isFinite);
  const judgeStatus = missing === tasks.length
    ? 'SKIP'
    : results.every((r) => r.judge?.status === 'SKIP') ? 'SKIP'
    : results.some((r) => r.judge?.status === 'ERROR') ? 'ERROR' : 'SCORED';
  let status;
  if (missing === tasks.length) status = 'SKIP';
  else if (deterministicPass < baseline.minDeterministicPass) status = 'FAIL';
  else if (judgeStatus === 'SKIP') status = 'PASS_DETERMINISTIC';
  else if (judgeScores.length && judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length < baseline.minJudgeAverage) status = 'FAIL';
  else status = 'PASS';
  const report = {
    schema: 1, suite: suite.suite, version: suite.version, mode: live ? 'live' : 'offline',
    status, deterministicPass, total: tasks.length, baseline,
    judgeStatus, judgeAverage: judgeScores.length ? Number((judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length).toFixed(2)) : null,
    unavailableLive: unavailable, model: live ? model : (results.find((r) => r.fixtureModel)?.fixtureModel ?? null),
    tasks: results, generatedAt: new Date().toISOString(),
  };
  writeReports(project, report);
  return report;
}

async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'llm-eval-'));
  const assertions = [];
  const cfg = { live: false, model: 'none', judgeModel: 'none', base: 'http://127.0.0.1:1', key: '' };
  try {
    mkdirSync(join(dir, 'evals', 'llm', 'fixtures'), { recursive: true });
    writeFileSync(join(dir, 'evals', 'llm', 'tasks.json'), JSON.stringify({
      schema: 1, suite: 'self', version: '0', system: '',
      tasks: [{ id: 't1', prompt: 'x', must: [['alfa'], ['beta']], forbid: ['gama'], rubric: 'r', maxWords: 10 }],
    }));
    writeFileSync(join(dir, 'evals', 'llm', 'baseline.json'), JSON.stringify({ minDeterministicPass: 1, minJudgeAverage: 1 }));
    writeFileSync(join(dir, 'evals', 'llm', 'fixtures', 't1.json'), JSON.stringify({ response: 'alfa beta', judge: { status: 'SCORED', score: 4, reason: 'ok' } }));
    assertions.push(['fixture limpa PASS', (await run(dir, cfg)).status === 'PASS']);
    writeFileSync(join(dir, 'evals', 'llm', 'fixtures', 't1.json'), JSON.stringify({ response: 'alfa gama', judge: { status: 'SCORED', score: 5, reason: 'ok' } }));
    assertions.push(['fixture ruim FAIL (gate falha de verdade)', (await run(dir, cfg)).status === 'FAIL']);
    rmSync(join(dir, 'evals', 'llm', 'fixtures', 't1.json'));
    assertions.push(['sem fixture SKIP (nunca PASS falso)', (await run(dir, cfg)).status === 'SKIP']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const ok = assertions.every(([, pass]) => pass);
  for (const [name, pass] of assertions) console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${name}`);
  console.log(`llm-eval self-test: ${ok ? 'PASS' : 'FAIL'} (${assertions.filter(([, p]) => p).length}/${assertions.length})`);
  return ok ? 0 : 1;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const project = resolve(argValue(args, '--project', process.cwd()));
  if (!existsSync(join(project, 'evals', 'llm', 'tasks.json'))) {
    console.error(`llm-eval: suite ausente em ${project}/evals/llm/tasks.json`);
    return 2;
  }
  const live = args.includes('--live') || args.includes('--record');
  loadEnvFile(join(process.env.HOME ?? '', '.omniroute', '.env'));
  const base = process.env.OMNIROUTE_BASE_URL ?? DEFAULT_BASE;
  const key = process.env.OMNIROUTE_API_KEY ?? '';
  const model = process.env.LLM_EVAL_MODEL ?? DEFAULT_MODEL;
  const judgeModel = process.env.LLM_EVAL_JUDGE_MODEL ?? model;
  if (live && !key) {
    console.error('llm-eval: OMNIROUTE_API_KEY ausente — SKIP (nunca PASS falso)');
    return 0;
  }
  const report = await run(project, { live, model, judgeModel, base, key });
  const extra = report.judgeAverage == null ? '' : ` judge=${report.judgeAverage}/5`;
  console.log(`llm-eval: ${report.status} — determinístico ${report.deterministicPass}/${report.total} (baseline ${report.baseline.minDeterministicPass})${extra}`);
  console.log(`relatório: evals/llm/report.json · modo ${report.mode} · judge ${report.judgeStatus}`);
  return report.status === 'FAIL' ? 1 : 0;
}

process.exit(await main());
