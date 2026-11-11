# Relatório técnico — engenharia reversa e réplica do shell "Gestão Pública"

Data: 2026-10-17 · Ferramenta principal: REA 6.5.0 (`rea-agents`, via `npx`) · Pack: skills `replica-*`

## 1. Identificação do alvo
`web/index.html` de um app **Flutter Web** multi-tenant ("Sistema de Gestão Pública"), fornecido pelo usuário como texto.
Cópia fiel em `replica/original/index.html` (4146 bytes). Não foram fornecidos nem lidos `main.dart.js`, `flutter_bootstrap.js` real ou `web_support.js`.

## 2. Objetivo
Entender tudo o que o documento faz, documentar defeitos com evidência e entregar um substituto direto, bem melhor, compatível com `flutter build web`.

## 3. Ambiente e ferramentas
| item | valor |
| --- | --- |
| SO | Windows 11 Pro 10.0.22000, AMD64 |
| Node / npm | v26.5.0 / 11.17.0 |
| Python | 3.12.10 |
| REA | 6.5.0 via `npx -y rea-agents@6.5.0` — **não instalado globalmente, `rea setup` não executado** |
| `rea doctor` | Node ✓, host ✓; Hopper/Ghidra/IDA/JADX ausentes (não necessários para JS); registros antigos do REA em Claude Code, Claude Desktop, Copilot CLI e VS Code em `config_drift` |
| Navegador | Chromium do painel embutido, servidor local `127.0.0.1` |
| Skills | replica-recon, -architect, -design, -build, -test, -diff (brand, backend, deploy, launch, entrepreneur: não se aplicam a um shell estático sem backend/marca nova) |

## 4. Comandos efetivamente executados (principais)
```bash
npx -y rea-agents@latest --help
npx -y rea-agents@6.5.0 doctor --json                                   # → evidence/rea-doctor.json (exit 1 = ambiente sem provedores nativos)
npx -y rea-agents@6.5.0 analyze-javascript-application <original> --json   # → evidence/rea-analyze-javascript-application.json (exit 0)
npx -y rea-agents@6.5.0 analyze-javascript-application <inline-scripts> --json  # → evidence/rea-analyze-inline-scripts.json (exit 0)
npx -y rea-agents@6.5.0 analyze-javascript-application <clone/web> --json  # → evidence/rea-analyze-clone.json (exit 0)
python contrast.py design/tokens.json ; python contrast.py design/tokens.dark.json   # 24 pares, 0 falhas
node --test replica/clone/tests/shell.test.mjs                            # 26/26
python parity.py replica/features.csv                                      # 95.5
CSP="script-src 'self'; …" node replica/tools/serve.mjs …                  # prova de CSP
```

## 5. Arquitetura e componentes identificados (original)
- Base href fixo `/`; meta PWA; favicon `<link id="favicon">`.
- **Script 1 (L35)** `sendToLexical(type, message)` → `window.top.frames[0].postMessage({type, payload}, '*')` — ponte Dart→editor Lexical num iframe (Lexical = editor rich-text; inferência pelo nome).
- **Script 2 (L134)** `window.onload`: `host.split('.')[1]` → `favicon-<rótulo>.ico` (identidade por tenant).
- **Script 3 (L143)** trava global de Tab; remove `.loading` no evento `flutter-first-frame`.
- CSS: `@font-face` Ubuntu Mono, `* { font-family … !important; caret-color: transparent !important }`, pixelated em baixa densidade, tema claro/escuro, spinner ciano 24 px.
- Externos: `web_support.js` (flutter_inappwebview_web, `defer`) e `flutter_bootstrap.js` (`async`).

## 6. Funcionalidades investigadas
Boot (F01), identidade por tenant (F02), ponte Lexical (F03), teclado (F04) — ver `recon.md`.

## 7. Evidências técnicas
| defeito | evidência |
| --- | --- |
| D1 fonte nunca carrega (`format('ttf')`) | runtime: `document.fonts=[]`, nenhuma requisição .ttf (`evidence/runtime-original.json`) |
| D2/D3 `--base-href` ignorado | `<base href="/">` fixo + `/assets/...` absolutos (HTML L17, L46, L154) |
| D4 spinner eterno | runtime: 404 em `flutter_bootstrap.js`, sem mensagem (`screens/S01-original-loading.jpg`) |
| D5 Tab bloqueado em toda a página | runtime: `defaultPrevented=true` |
| D6 ponte frágil/insegura | runtime: `TypeError … reading 'postMessage'`; REA AST: leitura `top.frames.0.postMessage` |
| D7 favicon inválido | 7 hosts sondados: `127.0.0.1`→`favicon-0.ico`, `bds.com.br`→`favicon-com.ico` … |
| D8 caret/fonte globais | runtime: `caretColor rgba(0,0,0,0)` |
| D9 sem `lang`/`viewport` | runtime |
| D10 CSS morto | `.sistemasbds`, `.flutter-loader` sem uso |
| D11 incompatível com CSP | REA: 3 inline bodies; **sob CSP os 3 são bloqueados** (`evidence/csp-strict.json`) |
| contraste | spinner original 2,02:1 sobre `#f2f0f1` (reprova WCAG 1.4.11) |

## 8. Conclusões comprovadas
- O original funciona só no caminho feliz; qualquer falha de carregamento deixa o usuário diante de um spinner eterno.
- Sob uma CSP estrita, o original perde a ponte Lexical, o favicon, a trava de Tab **e a remoção do loader**.
- A réplica preserva todas as funções do original (paridade 95,5; must-haves 6/6) e corrige D1–D11.

## 9. Inferências e limitações
- "Lexical" = editor Meta Lexical e "tenant = cliente/município": **inferências** pelos nomes.
- A réplica **não foi testada dentro de um `flutter build web` real**: o Flutter foi substituído por um simulador (`clone/dev/flutter_bootstrap.js`).
- Escopo do caret e detecção de semântica usam nomes internos do Flutter (`flt-text-editing-host`, `flt-semantics-host`), que podem mudar entre versões.
- REA não analisa HTML puro como página: a análise web do REA exige Chrome com depuração remota; usei a análise estática de JS + observação no Chromium do painel.
- `imgdiff.py` não rodou (só aceita PNG); axe não rodou (exigiria download).
- Peso: réplica 9,6 KB brotli (3 arquivos) vs 1,3 KB do original.

## 10. Problemas encontrados e soluções
| problema | solução |
| --- | --- |
| REA sem instalação global | `npx -y rea-agents@6.5.0` (sem alterar configurações) |
| REA ignorou os 3 scripts inline | extraídos para `.js` e reanalisados (126 nós AST) |
| `$FLUTTER_BASE_HREF` quebra o servidor local | `serve.mjs` substitui o token como o `flutter build` faz |
| simulador travava em aba sem pintura (B2) | `setTimeout` em vez de `requestAnimationFrame` |
| harness E2E com predicado inseguro (B1) | `editorReady()`; 14/14 na 2ª execução |
| `node --test <diretório>` falha no Node 26 | passar o arquivo |
| saída do `parity.py` em cp1252 | `PYTHONIOENCODING=utf-8` |

## 11. Arquivos e artefatos gerados
**Entregável (copiar para `web/` do projeto Flutter):**
`clone/web/index.html` · `clone/web/boot/shell.js` · `clone/web/boot/shell.css` · `clone/web/flutter_bootstrap.js` · `clone/web/manifest.json`

**Testes e dev:** `clone/tests/shell.test.mjs` · `clone/dev/flutter_bootstrap.js` (simulador) · `clone/dev/__dev/e2e.html` · `clone/dev/__dev/lexical.html` · `clone/dev/favicon.ico` · `clone/dev/assets/.../web_support.js` (stub) · `tools/serve.mjs` · `../.claude/launch.json`

**Documentação:** `recon.md` · `features.csv` · `architecture.md` · `design/tokens.json` · `design/tokens.dark.json` · `design/components.md` · `test-plan.md` · `bugs.md` · `build-log.md` · `parity.md` · `parity-score.md`

**Evidências:** `evidence/rea-doctor.json` · `evidence/rea-analyze-javascript-application.json` · `evidence/rea-analyze-inline-scripts.json` · `evidence/rea-analyze-clone.json` · `evidence/inline-scripts/*.js` · `evidence/runtime-original.json` · `evidence/csp-strict.json` · `evidence/e2e-results.json` · `evidence/unit-tests.txt` · `screens/S01-original-loading.jpg` · `clone-screens/*.jpg` (6)

## 12. Testes executados
| suíte | resultado |
| --- | --- |
| unidade (`node:test`) | **26/26** |
| E2E no navegador | **14/14** (1ª execução 13/14 por bug do harness, B1) |
| manuais (375 px escuro, teclado, CSP) | 3/3 |
| contraste WCAG | 24 pares, 0 falhas |
| REA na réplica | 0 scripts inline, 2 JS parseados, 3234 nós AST, 0 falhas |
| não executados | reduced-motion emulado; favicon em subdomínio real |

## 13. Próximas etapas
1. Copiar `clone/web/*` para `web/` do projeto, rodar `flutter build web` e repetir o E2E contra o build.
2. Validar caret e Tab com a versão de Flutter do projeto (`data-tab-policy="always"` restaura o comportamento antigo se necessário).
3. No editor Lexical, enviar `{type:'lexical:ready'}` ao pai e validar `event.origin`.
4. Testar o favicon num subdomínio de homologação.
5. Ativar `Content-Security-Policy: script-src 'self'` no servidor.

## Como instalar no projeto Flutter
1. Copie `index.html`, `flutter_bootstrap.js`, `manifest.json` e a pasta `boot/` para `web/`.
2. Mantenha seus `favicon.ico`, `favicon-<tenant>.ico`, `icons/` e a fonte em `assets/fonts/UbuntuMono-Regular.ttf`.
3. `flutter build web --base-href /` (ou o subcaminho de deploy).
4. Diagnóstico em produção: `?gpDebug=1` liga log; `GestaoBoot.timings()` no console mostra os tempos de boot.
