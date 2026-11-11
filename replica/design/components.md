# Componentes do shell

Tokens: `tokens.json` (claro) e `tokens.dark.json` (escuro), espelhados como custom
properties em `clone/web/boot/shell.css`. Contraste: 24 pares, 0 reprovações AA
(`python contrast.py`). Sem Tailwind: o shell não tem build step; os componentes usam
`var(--gp-*)`, nunca hex cru.

```
BootScreen (S01)
  regiões     marca (nome do app) · indicador · status (aria-live) · ações
  estados     loading, slow, error, ready (fade-out e remoção do DOM)
  tokens      bg, text, text-muted, accent, danger; motion.fade
  a11y        role="status" + aria-live="polite" no status; aria-busy no <body> até ready;
              erro move o foco para o título do erro
  usado em    S01

Spinner
  variantes   único (24px, traço 3px — medido do original)
  estados     girando · prefers-reduced-motion: pulsa opacidade, sem rotação
  tokens      accent (≥3:1 nos dois temas; original 2.02:1 no claro)
  a11y        aria-hidden="true" — o texto do status é que comunica

StatusText
  estados     "Carregando…" · "Iniciando o motor…" · "Abrindo o sistema…" · "Está demorando mais que o normal…"
  tokens      text-muted, type.sm
  a11y        região viva educada; muda no máximo 1x por fase

ErrorCard
  variantes   timeout · falha de script · falha do motor · navegador sem suporte
  tokens      surface, border, danger (título), radius.md, shadow.card, size.card-max
  conteúdo    título, explicação curta, <details> com o motivo técnico (textContent, nunca HTML)
  ações       Button primary "Tentar novamente" (location.reload)
              Button secondary "Limpar cache e recarregar" (desregistra SW + apaga CacheStorage do próprio site)
  a11y        foco vai ao título (tabindex=-1); botões reais; Tab sempre funciona aqui

Button
  variantes   primary, secondary
  tamanho     44px de altura mínima (alvo de toque)
  estados     default, hover, active, focus-visible (anel 2px accent + offset 2px), disabled
  tokens      primary: bg accent / on-accent; secondary: transparente / text + border-input

NoScriptNotice
  conteúdo    "Ative o JavaScript para usar o Gestão Pública."
  tokens      text, bg
```
