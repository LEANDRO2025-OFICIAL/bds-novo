# Bugs — réplica do shell

Só o que foi reproduzido. Defeitos do **original** estão em `recon.md` (D1–D11).

## B1 — predicado de espera do harness E2E lança antes do editor carregar
- severidade: S3 (infraestrutura de teste; o produto não foi afetado)
- passos: abrir `/__dev/e2e.html` (1ª execução)
- esperado: F03-E1 passa
- obtido: `Cannot read properties of undefined (reading 'length')`
- causa: `until()` relança a exceção do predicado no último ciclo; o iframe do editor ainda estava em `about:blank`
- prova de que o shell estava certo: caso reproduzido isolado → `sent` e entregue (200 mil chars)
- correção: `editorReady()` com guardas em `dev/__dev/e2e.html`; 2ª execução 14/14
- status: **corrigido**

## B2 — simulador não dispara o primeiro quadro em aba que não está pintando
- severidade: S3 (só no overlay de desenvolvimento)
- passos: `/?sim=ok` com o painel do navegador sem renderizar
- esperado: `ready`
- obtido: preso em `loading`/`slow` com o app simulado já montado
- causa: `requestAnimationFrame` não executa em aba sem pintura
- correção: `setTimeout(…, 0)` em `dev/flutter_bootstrap.js`
- status: **corrigido**

## A verificar (não reproduzido)
- Escopo do caret (`flt-text-editing-host`) contra um build Flutter real da versão usada no projeto.
- Política `app` de Tab contra o Flutter real com e sem semântica ligada.
- Fallback do favicon de tenant em um subdomínio real (ex.: `gestao.<cliente>.com.br`).

Abertos: S1 0 · S2 0 · S3 0 · S4 0.
