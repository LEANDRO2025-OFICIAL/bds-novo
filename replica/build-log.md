# Log de build

| tela | data | status | falta | mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| S01 Carregamento (loading / slow / error / ready) | 2026-10-17 | feito | validação contra Flutter real | detectar falha de `<script>` sem `onerror` inline (resolvido com listener de captura) |
| Ponte Lexical (S02→S03) | 2026-10-17 | feito | validar com o editor Lexical real | entregar mensagens enviadas antes do iframe carregar (fila + handshake + `load`) |
| `flutter_bootstrap.js` customizado | 2026-10-17 | feito | rodar `flutter build web` no projeto | — |

Sem commits: a pasta da sessão não é um repositório git.
