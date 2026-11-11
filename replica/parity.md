# Paridade — réplica vs original

Pontuação gerada por `parity.py` (detalhe em `parity-score.md`):

- **Paridade de features: 95,5 / 100** — must-haves que o original tinha: **6 de 6**.
- Área mais fraca: a11y 75 (caret escopado = `partial`, falta validar contra build Flutter real).
- **12 capacidades novas** que o original não tem (não pontuadas).

## Layout
`imgdiff.py` **não foi executado**: ele lê só PNG e o painel do navegador gera JPEG.
O layout mudou de propósito (nome do app, texto de status, cartão de erro); o
spinner mantém tamanho (24 px), traço (3 px) e posição central do original.
Referência: `screens/S01-original-loading.jpg` × `clone-screens/S01-*.jpg`.

## Comportamento

| fluxo | original faz | réplica faz | decisão |
| --- | --- | --- | --- |
| F01 boot normal | spinner some no 1º quadro (remoção abrupta) | fases + fade de 240 ms; remoção imediata com reduced-motion | manter |
| F01 bootstrap 404 / motor falha / travou | spinner eterno, sem mensagem | cartão de erro por tipo, foco no título, "Tentar novamente" e "Limpar cache" | manter |
| F01 sob CSP `script-src 'self'` | 3 scripts bloqueados; loader nunca sairia | funciona inteiro | manter |
| F01 `--base-href /app/` | ignorado (base fixo "/" + caminhos absolutos) | respeitado | manter |
| F02 favicon | `split('.')[1]` em `window.onload`; gera `favicon-0.ico`, `favicon-com.ico` | mesmo rótulo quando é cliente; padrão quando seria lixo; sondagem antes de trocar | manter |
| F03 `sendToLexical` | `top.frames[0]`, `'*'`, lança TypeError sem iframe | mesmo nome/assinatura; origem exata; fila + handshake; retorna `sent/queued/dropped` | manter |
| F03 respostas do editor | inexistente | `GestaoBoot.lexical.on()` + evento `lexical-message`, validando origem e janela | manter |
| F04 Tab | bloqueado em toda a página | bloqueado só no canvas sem leitor de tela (`data-tab-policy="always"` restaura o original) | manter |

## Veredito
**Melhor que o original.** Todos os must-haves feitos, paridade 95,5, nenhum bug S1/S2 aberto, e 11 defeitos do original corrigidos com evidência.
Ressalva honesta: nada disso foi validado ainda dentro de um `flutter build web` real do projeto.

## Próximos 5
1. Rodar `flutter build web` no projeto real com estes arquivos e repetir o E2E contra o build.
2. Validar o escopo do caret e a política de Tab com a versão de Flutter do projeto.
3. Confirmar no Dart quais `type` o editor Lexical usa e adotar o handshake `lexical:ready` no editor.
4. Testar o favicon de tenant num subdomínio real de homologação.
5. Publicar a CSP `script-src 'self'` como cabeçalho do servidor (agora é possível).
