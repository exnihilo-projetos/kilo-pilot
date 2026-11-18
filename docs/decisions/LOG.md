# LOG DE DECISÕES — kilo-pilot (append-only)

- 2026-11-18: **Piloto criado**. `SPEC-0001` + `spec/contract.json`; 11 testes com tags
  `[AC-1..4]`; `spec-trace` (self-test fail/pass) PASS; `mandate-guard` (escopo/orçamento/
  expiração/revogação/kill switch) PASS com auditoria `.kilo/agent-audit.ndjson`;
  `agent/run-task.mjs` executa `node --test` sob mandato; `eval` 5/5 com baseline; gate
  `pilot-gate.sh` 8/8 e manifesto `docs/deliveries/kilo-pilot.json`. Sem dependências; MIT;
  public-ready, não publicado. Limite: o operador é determinístico (não um LLM) e a integração
  com o runtime global ainda é manual.
