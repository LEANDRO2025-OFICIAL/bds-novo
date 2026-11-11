# Mapa de reconhecimento: "Gestão Pública" — shell Flutter Web (web)

Escopo: o documento de inicialização (`web/index.html`) de um app Flutter Web multi-tenant de gestão pública — carregamento, identidade por subdomínio, ponte com editor Lexical, políticas de teclado/caret/fonte. **O app Flutter em si (main.dart.js) não foi fornecido e não está no escopo.**
Para: o próprio usuário (equipe que mantém o sistema), como substituto direto do `web/index.html`.
Data: 2026-10-17

## Fontes

| # | fonte | URL / caminho | notas |
| --- | --- | --- | --- |
| 1 | HTML fornecido pelo usuário | `replica/original/index.html` | única fonte primária; 4146 bytes; sha256 do diretório `aeb03b21…e6f1` |
| 2 | REA `analyze-javascript-application` (HTML) | `replica/evidence/rea-analyze-javascript-application.json` | 2 scripts externos não resolvidos; 3 scripts inline marcados como não analisados |
| 3 | REA `analyze-javascript-application` (scripts inline extraídos) | `replica/evidence/rea-analyze-inline-scripts.json` | 3 arquivos, 126 nós AST, 73 nós semânticos, 0 falhas |
| 4 | Observação em runtime (Chromium, 127.0.0.1) | `replica/evidence/runtime-original.json` | 404s, Tab bloqueado, `document.fonts` vazio, `sendToLexical` lança TypeError |
| 5 | Screenshot de referência | `replica/screens/S01-original-loading.jpg` | nunca entra na réplica |
| 6 | Template oficial Flutter `web/index.html` e `flutter_bootstrap.js` (docs.flutter.dev, "Customizing web app initialization") | conhecimento público | tokens `{{flutter_js}}`, `{{flutter_build_config}}`, `$FLUTTER_BASE_HREF`, evento `flutter-first-frame` |

Não foram lidos: `main.dart.js`, `flutter_bootstrap.js` real, `web_support.js` (não fornecidos; regra clean-room).

## Core loop

O usuário abre a URL do município/órgão → vê um indicador de carregamento com a identidade do tenant → o app Flutter pinta o primeiro quadro e assume a tela.

## Telas

| ID | tela | como chegar | propósito | componentes | estados vistos |
| --- | --- | --- | --- | --- | --- |
| S01 | Carregamento | qualquer URL do app | ocupar a tela até o 1º quadro do Flutter | spinner 24px ciano (`.loading > .loader`) | carregando (único). **Não existem**: erro, timeout, sem-JS, navegador antigo, offline |
| S02 | App Flutter | após `flutter-first-frame` | sistema de gestão | `<flutter-view>` (canvas) | fora do escopo |
| S03 | Editor Lexical (iframe) | aberto pelo app | edição rich-text | iframe que recebe `postMessage` | inferido; não observado |

## Fluxos

```
F01 Abrir o sistema
    S01 -> S02
    caminho feliz: 0 cliques (só espera)
    edge: flutter_bootstrap.js 404/timeout -> spinner eterno (OBSERVADO)
          JS desabilitado -> página em branco com spinner parado
          deploy em subcaminho (/app/) -> base href fixo "/" quebra todos os assets

F02 Identidade do tenant (favicon)
    window.onload -> host.split('.')[1] -> favicon-<label>.ico
    edge: IP 127.0.0.1 -> favicon-0.ico; bds.com.br -> favicon-com.ico; arquivo inexistente -> sem ícone
          só roda após TODOS os recursos (window.onload), e sobrescreve outros onload

F03 Dart envia comando ao editor Lexical
    Dart (js interop) -> sendToLexical(type, payload) -> window.top.frames[0].postMessage(msg, '*')
    edge: nenhum iframe -> TypeError (OBSERVADO); app embutido em outro site -> top é o site de fora;
          outro iframe antes do editor -> mensagem vai para o frame errado; '*' entrega payload a qualquer origem

F04 Navegação por teclado
    keydown Tab em qualquer lugar -> preventDefault (OBSERVADO)
    efeito: usuário de teclado/leitor de tela não sai do app nem navega por Tab no HTML
```

## Componentes

| componente | variantes | estados | usado em |
| --- | --- | --- | --- |
| Loader (spinner) | único | girando | S01 |
| Favicon dinâmico | por subdomínio | padrão / tenant | todas |
| Ponte Lexical | `sendToLexical(type, payload)` | sem destino → exceção | S02→S03 |
| Política de teclado | trava global de Tab | sempre ligada | todas |
| Política de caret | caret transparente global | sempre | todas (provável contorno do caret duplicado do Flutter) |

## Modelo de dados inferido

```
Tenant        id (= 2º rótulo do host), favicon_url
              evidência: inline-2-L134.js (location.host.split → favicon.href)
              confiança: alta para o mecanismo; palpite para o significado "município/cliente"

LexicalMessage  { type: string, payload: any }
              evidência: inline-1-L35.js (postMessage({type, payload}))
              confiança: alta para a forma; palpite para os tipos usados pelo Dart

BootPhase     loading | first-frame
              evidência: inline-3-L143.js (flutter-first-frame → remove .loading)
              confiança: alta
```

Relações: Tenant 1-1 Favicon; App 1-n LexicalMessage → iframe editor.

## Achados de defeito (evidência)

| # | defeito | evidência | gravidade |
| --- | --- | --- | --- |
| D1 | `format('ttf')` inválido → `@font-face` descartado, fonte nunca baixa | runtime: `document.fonts=[]`, sem request da .ttf | média |
| D2 | `<base href="/">` fixo em vez de `$FLUTTER_BASE_HREF` → `--base-href` ignorado | HTML linha 17 + comentário que promete o contrário | alta em deploy por subcaminho |
| D3 | assets com caminho absoluto `/assets/...` ignoram base href | HTML linhas 46 e 154 | alta em subcaminho |
| D4 | spinner eterno sem erro/timeout/noscript | runtime: 404 em bootstrap, spinner permanece | alta (UX) |
| D5 | Tab bloqueado globalmente (WCAG 2.1.1) | runtime: `defaultPrevented=true` | alta (acessibilidade) |
| D6 | `sendToLexical` frágil: `top.frames[0]` + `'*'` | runtime: TypeError; AST: `top.frames.0.postMessage` | alta (segurança/robustez) |
| D7 | favicon por `split('.')[1]` gera nomes inválidos, sem fallback, em `window.onload` | sonda com 7 hosts | média |
| D8 | caret transparente e `font-family !important` em `*` | runtime: `caretColor rgba(0,0,0,0)` | média (a11y) |
| D9 | sem `lang`, sem `viewport`, `X-UA-Compatible` obsoleto | runtime | baixa |
| D10 | CSS morto: `.sistemasbds`, `.flutter-loader` sem uso; `-webkit-max-device-pixel-ratio` só WebKit | leitura do HTML | baixa |
| D11 | 3 scripts inline impedem CSP `script-src 'self'` sem `unsafe-inline` | REA: 3 inline bodies | média (segurança) |

## Matriz de features

Ver `features.csv`. Must: 9, should: 7, could: 4, skip: 3.

## Fora do escopo

- O app Flutter (telas de gestão, regras de negócio, API) — não fornecido; não será lido nem recriado.
- O editor Lexical e o pacote `flutter_inappwebview_web` — terceiros; a réplica só define o contrato da ponte.
- Ícones e marca de cada tenant — ativos de terceiros; a réplica usa placeholders.

## Tamanho

Telas 1 (+2 fora do escopo), fluxos 4, entidades 3. Partes difíceis: ponte postMessage segura com handshake, detecção confiável de falha do bootstrap Flutter, trava de Tab sem quebrar acessibilidade. Tamanho: **S**.
