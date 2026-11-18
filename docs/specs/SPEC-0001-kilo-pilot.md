# SPEC-0001 — kilo-pilot money core

- **Status:** approved
- **Owner:** founder
- **Contrato executável:** `spec/contract.json`
- **Objetivo:** provar o ciclo spec → contrato → teste → evidência em um projeto público mínimo.

## Contexto

`kilo-pilot` é um projeto de conformidade do ambiente Kilo, não um produto financeiro. O domínio
(money) foi escolhido por ter invariantes objetivos e testáveis sem dependências.

## Invariantes

- Valores monetários são inteiros em centavos; nunca floats no estado.
- `parseAmount` aceita apenas string canônica com até 2 casas decimais; não aceita separador de milhar.
- `addAmounts` é exato e rejeita centavos não inteiros.
- `formatBRL` usa `pt-BR`/`BRL` e formata negativos.
- `assertNonNegative` falha com código tipado (`NEGATIVE_AMOUNT`/`INVALID_CENTS`).

## Critérios de aceite

- **AC-1:** parse canônico para centavos; rejeita >2 casas, formato inválido e não-string.
- **AC-2:** soma exata de centavos; soma vazia = 0; rejeita não-inteiros.
- **AC-3:** formata BRL, incluindo negativo.
- **AC-4:** aceita >= 0; rejeita negativo/não-inteiro com código tipado.

Cada AC tem uma tag `[AC-n]` em pelo menos um teste. `tools/verification/spec-trace.mjs` falha
se um AC não tiver teste, se houver tag órfã ou se o contrato estiver inválido.

## Evidência

- `node --test` → 11 testes.
- `node tools/verification/spec-trace.mjs` → relatório `docs/deliveries/spec-trace.json`.
- `node tools/agent/eval.mjs` → golden tasks + baseline.
- `bash tools/verification/pilot-gate.sh` → gate completo + manifesto.

## Rollback

Reverter `src/money.js`, `tests/money.test.js`, `spec/contract.json` e esta spec; remover o
relatório de trace e o manifesto.
