# Plano de testes — shell "Gestão Pública"

Alvo: a réplica (`replica/clone/web`), nunca o sistema em produção.
Execução: unidade `node --test replica/clone/tests/shell.test.mjs`; E2E abrindo
`http://localhost:5502/__dev/e2e.html` (config `replica` do `.claude/launch.json`).

| caso | fluxo | tipo | como | resultado |
| --- | --- | --- | --- | --- |
| F01-H1 | abrir o sistema | feliz | E2E `?sim=ok` | passou |
| F01-E1 | rede lenta | borda | E2E `?sim=slow&gpDebug=1&gpSlow=400` | passou |
| F01-E2 | deploy em subcaminho (base href) | borda | E2E: `<base>` substituído, scripts relativos | passou |
| F01-E3 | largura 375 px + tema escuro | borda | manual (painel, emulação mobile/dark) | passou — sem overflow, botões 44 px |
| F01-E4 | só teclado na tela de erro | borda | manual (Tab real) + E2E F04-H1 | passou — foco visível nos 2 botões |
| F01-E5 | CSP `script-src 'self'` | borda | servidor com cabeçalho CSP | passou (original falha) |
| F01-E6 | prefers-reduced-motion | borda | — | **não executado** (sem emulação disponível) |
| F01-N1 | falha do motor | negativo | E2E `?sim=fail` | passou — foco no título |
| F01-N2 | script essencial 404 | negativo | E2E `?sim=404` | passou |
| F01-N3 | travamento → timeout → quadro tardio | negativo | E2E `?sim=hang&gpTimeout=1000` | passou |
| F01-N4 | injeção HTML no detalhe do erro | negativo | E2E `GestaoBoot.fail('<img onerror>')` | passou — texto puro |
| F02-H1 | favicon em localhost | feliz | E2E | passou |
| F02-E1 | 7 formatos de host (IP, IPv6, sufixos, caixa, ponto final) | borda | unidade `resolveTenant` | passou |
| F02-E2 | favicon do tenant inexistente → padrão | borda | — | **não executado no navegador** (exige subdomínio real); lógica coberta por leitura de código |
| F03-H1 | mensagem antes do editor existir | feliz | E2E | passou — fila + handshake |
| F03-H2 | ida e volta com acentos e emoji | borda | E2E | passou |
| F03-E1 | payload de 200 mil caracteres | borda | E2E | passou (2ª execução; ver B1) |
| F03-N1 | mensagem forjada por outra janela | negativo | E2E + unidade | passou |
| F03-N2 | sem editor: não lança | negativo | E2E + unidade | passou |
| F03-N3 | payload não clonável / sem `type` / origem opaca | negativo | unidade | passou |
| F04-H1 | Tab: canvas / leitor de tela / cartão de erro | feliz+borda | E2E + unidade | passou |

Totais: unidade 26/26 · E2E 14/14 (2ª execução) · manuais 3/3 · não executados 2.
Axe (acessibilidade automatizada) não foi rodado: exigiria baixar `@axe-core`; contraste foi verificado com `contrast.py` (24 pares, 0 falhas).
