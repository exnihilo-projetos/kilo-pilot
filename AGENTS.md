# kilo-pilot — AGENTS.md

Projeto público de conformidade (MIT, sem dependências) para provar o ciclo
**spec → contrato executável → teste → mandato → eval → manifesto**.

## Constituição curta

1. A spec é a fonte de verdade; `spec/contract.json` é o contrato executável.
2. Todo AC tem uma tag `[AC-n]` em pelo menos um teste; `spec-trace` falha sem isso.
3. O operador só executa sob `agent/mandate.json`: escopo, orçamento, expiração e revogação.
4. O kill switch é `.kilo/agent-kill`; o mandato revogado/expirado é recusado.
5. Toda mudança de comportamento passa por `eval` (golden tasks + baseline).
6. O gate é `bash tools/verification/pilot-gate.sh`; sem PASS, não há entrega.
7. O manifesto rastreado é `docs/deliveries/kilo-pilot.json`.

## Comandos

```bash
node --test
node tools/verification/spec-trace.mjs
node tools/agent/mandate-guard.mjs
node agent/run-task.mjs
node tools/agent/eval.mjs
bash tools/verification/pilot-gate.sh
```

## Persistência

Decisões completas em `docs/decisions/LOG.md` (append-only). Esta é uma trilha de referência,
não um produto financeiro; nenhum dado real é usado.
