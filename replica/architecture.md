# Arquitetura da réplica — shell Flutter Web "Gestão Pública"

Lê: `replica/recon.md`, `replica/features.csv`. Data: 2026-10-17.

## 1. Stack

| camada | escolha | por quê |
| --- | --- | --- |
| documento | HTML5 estático (`web/index.html`) | precisa continuar sendo processado por `flutter build web` (tokens `$FLUTTER_BASE_HREF`) |
| estilo | CSS puro externo (`boot/shell.css`) com tokens em `:root` | sem build step; externo para permitir CSP sem `unsafe-inline` |
| lógica | JavaScript ES2017 sem dependências (`boot/shell.js`), núcleo puro + adaptador DOM | roda antes do Flutter, testável em Node sem navegador |
| bootstrap | `web/flutter_bootstrap.js` customizado (tokens `{{flutter_js}}`, `{{flutter_build_config}}`) | API oficial do Flutter ≥3.22 para observar fases e capturar falhas |
| testes | `node:test` (unidade) + navegador Chromium (E2E instrumentado) + REA (evidência estática) | nada para instalar |
| banco / API / auth | **não se aplica** | o shell não tem estado persistente nem servidor |

Sem framework, sem bundler, sem dependências npm: o shell é o primeiro byte do sistema e precisa ser o mais leve e previsível possível.

## 2. "Schema": contratos (no lugar de tabelas)

Não há banco. Os contratos estáveis são estes:

### 2.1 Configuração (atributos `data-*` no `<html>`)

| atributo | padrão | valores | substitui |
| --- | --- | --- | --- |
| `data-app-name` | `Gestão Pública` | texto | texto exibido no loader/erro |
| `data-boot-slow-ms` | `8000` | ms | aviso "está demorando" |
| `data-boot-timeout-ms` | `45000` | ms | estado de erro por tempo |
| `data-tab-policy` | `app` | `app` \| `always` \| `never` | trava global de Tab (D5); `always` = comportamento original |
| `data-caret-policy` | `flutter` | `flutter` \| `all` \| `none` | caret transparente em `*` (D8); `all` = original |
| `data-tenant-strategy` | `compat` | `compat` \| `off` | regra `split('.')[1]` (D7) |
| `data-tenant-favicon` | `favicon-{tenant}.ico` | padrão com `{tenant}` | nome do arquivo por tenant |
| `data-lexical-selector` | `iframe[data-lexical],iframe[name="lexical"]` | seletor CSS | `window.top.frames[0]` (D6) |
| `data-lexical-legacy-fallback` | `true` | `true` \| `false` | usar `window.frames[0]` se o seletor falhar |

Query `?gpDebug=1` liga log detalhado e permite `gpTimeout`/`gpSlow` na URL (diagnóstico em produção sem rebuild).

### 2.2 API global `window.GestaoBoot`

```
GestaoBoot.phase(name)            // 'bootstrap' | 'engine' | 'app' — chamado pelo flutter_bootstrap.js
GestaoBoot.fail(error)            // erro fatal de boot → tela de erro
GestaoBoot.state                  // 'loading' | 'slow' | 'error' | 'ready'
GestaoBoot.timings()              // { 'gp:shell→first-frame': ms, ... }
GestaoBoot.tenant                 // string | null
GestaoBoot.lexical.send(type, payload) → 'sent' | 'queued' | 'dropped'
GestaoBoot.lexical.on(type|'*', fn) → unsubscribe
window.sendToLexical(type, payload)    // compatível com o original; nunca lança
```

### 2.3 Mensagem da ponte Lexical

```
pai → iframe   { type: string, payload: any }                      (mesma forma do original)
iframe → pai   { type: 'lexical:ready' }  → libera a fila
iframe → pai   { type: string, payload: any } → listeners + CustomEvent 'lexical-message'
targetOrigin   = origem do src do iframe (nunca '*'); srcdoc/about:blank → location.origin
aceite         = event.source === iframe.contentWindow && event.origin === targetOrigin
```

### 2.4 Máquina de estados do boot

```
loading ──(slow_ms)──▶ slow ──┐
   │                          │
   ├──(flutter-first-frame)───┴──▶ ready   (loader faz fade e sai do DOM)
   └──(script 404 | GestaoBoot.fail | timeout_ms)──▶ error  (botões: tentar de novo / limpar cache)
error ──(flutter-first-frame tardio)──▶ ready
```

## 3. Rotas (arquivos servidos)

| caminho | o que é | quem usa |
| --- | --- | --- |
| `index.html` | documento | navegador |
| `boot/shell.css` | estilos do shell | index.html |
| `boot/shell.js` | núcleo + adaptador DOM | index.html (síncrono, antes do bootstrap) |
| `flutter_bootstrap.js` | template customizado (fases + erro) | `flutter build web` gera o final |
| `manifest.json` | PWA com `lang`, cores, `start_url` relativo | navegador |
| `assets/packages/flutter_inappwebview_web/assets/web/web_support.js` | do pacote | inalterado (agora relativo ao base href) |
| `dev/*` (só overlay local) | simulador do Flutter, editor Lexical falso | servidor de desenvolvimento |

## 4. Partes que mordem

- **Ordem de execução**: o listener de `flutter-first-frame` precisa existir antes do `flutter_bootstrap.js` (async). `shell.js` é síncrono e vem antes no documento → garantido.
- **Base href**: com `$FLUTTER_BASE_HREF`, servir o arquivo cru quebra tudo; o servidor de dev substitui o token como o `flutter build` faz.
- **Nomes internos do Flutter** (`flutter-view`, `flt-text-editing-host`, `flt-semantics-host`) podem mudar entre versões → usados só para políticas opcionais, com degradação segura.
- **Multi-tenancy**: a regra `compat` preserva o rótulo escolhido pelo original, mas recusa IP/localhost e cai no favicon padrão se o arquivo do tenant não existir.
- **Segurança postMessage**: `'*'` vazava payload; agora a origem é derivada do `src`, e a resposta é validada por `source` e `origin`.
- **Cache de service worker antigo** é causa clássica de boot preso: o botão "limpar cache" remove registros de SW e `CacheStorage` só quando o usuário clica.

## 5. Ordem de build

1. **Fatia vertical**: `index.html` + `shell.js` mínimo + simulador → loader some no primeiro quadro.
2. **Musts**: base href, erro/retry, Tab acessível, favicon com fallback, ponte Lexical segura, scripts originais preservados.
3. **Shoulds**: caret escopado, fonte corrigida, noscript, aviso de lentidão, reduced-motion, lang/viewport.
4. **Coulds**: fases visíveis, CSP sem inline, handshake/fila, telemetria.
