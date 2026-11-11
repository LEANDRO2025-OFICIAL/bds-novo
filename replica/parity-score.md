## Parity: 95.5 / 100

features 95.5  (8 counted, must-haves 6 of 6 done)

## By area, weakest first
- a11y                          75.0  (2 features)
- boot                         100.0  (3 features)
- identidade                   100.0  (1 features)
- integração                   100.0  (2 features)

## Missing, in build order
- [should] a11y: Caret transparente apenas nos campos internos do Flutter, partial  (escopado por nomes internos do Flutter (flt-text-editing-host); não validado contra um build Flutter real)

## Left out on purpose (not scored)
- App Flutter de gestão pública: não fornecido; fora do escopo clean-room
- Editor Lexical: componente de terceiro; só o contrato da ponte é replicado
- Ícones e marca de cada tenant: ativos do cliente; réplica usa placeholders

## Yours, not in the original (not scored)
- Base href substituível pelo flutter build
- Estado de erro com tentar novamente
- Navegação por teclado acessível
- Fonte Ubuntu Mono carregando de fato
- Aviso noscript
- Timeout com mensagem de lentidão
- Respeitar prefers-reduced-motion
- lang pt-BR e meta viewport
- Fases de boot visíveis (motor / app)
- Scripts externos compatíveis com CSP sem unsafe-inline
- Handshake e fila de mensagens da ponte Lexical
- Telemetria de tempo de boot (performance.mark)
