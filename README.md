# kilo-pilot

Projeto público mínimo (MIT, sem dependências) usado como **piloto de conformidade** do ambiente Kilo:
prova que uma mudança nasce de uma spec, vira contrato executável, tem testes rastreados,
é executada por um operador com mandato/orçamento/revogação e é avaliada por um harness.

```bash
node --test
node tools/verification/spec-trace.mjs
node tools/agent/eval.mjs
node tools/agent/mandate-guard.mjs
bash tools/verification/pilot-gate.sh
```

- `docs/specs/SPEC-0001-kilo-pilot.md` — a spec.
- `spec/contract.json` — o contrato executável (ACs → testes).
- `tools/verification/spec-trace.mjs` — falha se um AC não tem teste.
- `agent/mandate.json` — escopo, orçamento, expiração e revogação do operador.
- `tools/agent/mandate-guard.mjs` — recusa mandato expirado/revogado/fora do escopo.
- `tools/agent/eval.mjs` — golden tasks + baseline + score.
