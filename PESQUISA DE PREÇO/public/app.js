// Banco de Preços LS — interface (SPA sem dependências). Todo dado externo passa por esc().
// A CSP proíbe style="" e scripts embutidos: estilos vêm de classes/atributos; larguras dinâmicas, de data-*.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => (v === null || v === undefined ? '—' : BRL.format(v));
const dec = (v, casas = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const num = (v, casas = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const data = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const pct = (v) => (v === null || v === undefined ? '—' : `${dec(v * 100, 1)}%`);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Data LOCAL em AAAA-MM-DD (toISOString usaria UTC e viraria o dia à noite no Brasil)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diaMes = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const diaHora = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const doBanco = (s) => new Date(`${String(s).replace(' ', 'T')}Z`); // datetime('now') do SQLite é UTC
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const NOME_METODO = { media: 'média', mediana: 'mediana', menor: 'menor preço' };
const METODOS = [
  ['auto', 'Automático', 'Média se a amostra for homogênea (CV ≤ 25%); senão, mediana.'],
  ['media', 'Média', 'Indicada quando os preços variam pouco entre si.'],
  ['mediana', 'Mediana', 'Resiste a valores extremos; a mais usada em amostras heterogêneas.'],
  ['menor', 'Menor preço', 'Use quando houver justificativa para adotar o menor valor.'],
];
const CRITERIOS = [
  ['nenhum', 'Nenhum', 'Só exclusões manuais, sempre justificadas.'],
  ['desvio', 'Desvio padrão', 'Exclui o que estiver fora de média ± z desvios padrão (escore z).'],
  ['iqr', 'Amplitude interquartil', 'Exclui o que estiver fora de Q1 − 1,5×IQR a Q3 + 1,5×IQR (Tukey).'],
  ['mediana', '% da mediana', 'Exclui o que se afastar da mediana além de um percentual.'],
];
const NOME_CRITERIO = Object.fromEntries(CRITERIOS.map(([k, n]) => [k, n]));
const NOME_ORIGEM = { 'compras.gov.br': 'Compras.gov.br', pncp: 'PNCP', 'cotacao-fornecedor': 'Cotação', 'midia-especializada': 'Mídia especializada', 'site-eletronico': 'Site', 'contratacao-similar': 'Contratação similar', 'nota-fiscal': 'Nota fiscal', manual: 'Manual' };
const NOME_ACAO = { desconsiderar: 'Desconsiderada', considerar: 'Considerada manualmente', criterio: 'Devolvida ao critério automático', justificar: 'Justificativa registrada', remover: 'Removida da pesquisa' };

const LOADER = '<svg class="loader" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="4.5" height="15" rx="1"/><rect x="9.75" y="6" width="4.5" height="15" rx="1"/><rect x="16.5" y="6" width="4.5" height="15" rx="1"/><line x1="1" y1="4" x2="23" y2="4"/></svg>';
const IC = {
  mais: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  seta: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4.5L15.5 10 11 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  voltar: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H5m4-4.5L4.500 10 9 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  doc: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h7l3.5 3.500v11.500H5zM12 2.500V6h3.500M7.500 10h5M7.500 13h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  baixar: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9.500m-4-4 4 4 4-4M4 16.500h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lupa: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.500" cy="8.500" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m12.500 12.500 4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  lixo: '<svg class="icone" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m-6 0 .700 10h6.600L14 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const main = $('#conteudo');
const reduzMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ infraestrutura

async function api(caminho, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${caminho}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && caminho !== '/login' && !$('#form-login')) telaLogin(); // sessão expirou
  if (!res.ok) throw new Error(json.erro || `Erro ${res.status}`);
  return json;
}

let avisoTimer;
function avisar(msg, erro = false) {
  const el = $('#aviso');
  el.hidden = true; // reinicia a animação de entrada
  el.textContent = msg;
  el.classList.toggle('erro', erro);
  el.setAttribute('role', erro ? 'alert' : 'status');
  void el.offsetWidth;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, erro ? 8000 : 4000);
}

/**
 * Diálogo modal próprio (<dialog>): confirmação ou pedido de texto.
 * Resolve com false (cancelou), true (confirmou) ou o texto digitado quando há `campo`.
 */
function dialogo({ titulo, texto = '', confirmar = 'Confirmar', cancelar = 'Cancelar', perigo = false, campo = null }) {
  const d = $('#dialogo');
  d.innerHTML = `<form method="dialog" novalidate>
    <h2 id="dialogo-titulo">${esc(titulo)}</h2>
    ${texto ? `<p>${texto}</p>` : ''}
    ${campo ? `<div class="campo"><label for="dialogo-campo">${esc(campo.rotulo)}<span class="obrig" aria-hidden="true">*</span></label>
      <textarea id="dialogo-campo" maxlength="2000" required aria-describedby="dialogo-erro" placeholder="${esc(campo.exemplo || '')}">${esc(campo.valor || '')}</textarea>
      <span class="campo__erro" id="dialogo-erro" aria-live="polite"></span></div>` : ''}
    <div class="botoes"><button type="button" class="btn btn--fantasma" data-acao="cancelar">${esc(cancelar)}</button>
      <button type="submit" class="btn ${perigo ? 'btn--perigo' : 'btn--primario'}" data-acao="ok">${esc(confirmar)}</button></div>
  </form>`;
  return new Promise((resolver) => {
    let resultado = false;
    const form = $('form', d);
    $('[data-acao="cancelar"]', d).addEventListener('click', () => d.close());
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (campo) {
        const valor = $('#dialogo-campo').value.trim();
        if (valor.length < (campo.minimo || 5)) {
          $('#dialogo-erro').textContent = `Escreva ao menos ${campo.minimo || 5} caracteres.`;
          $('#dialogo-campo').setAttribute('aria-invalid', 'true');
          $('#dialogo-campo').focus();
          return;
        }
        resultado = valor;
      } else resultado = true;
      d.close();
    });
    d.addEventListener('close', () => resolver(resultado), { once: true });
    d.showModal();
    (campo ? $('#dialogo-campo') : $('[data-acao="cancelar"]', d)).focus();
  });
}

function preferencias() {
  try { return JSON.parse(localStorage.getItem('pp:filtros') || '{}'); } catch { return {}; }
}
function salvarPreferencias(p) {
  try { localStorage.setItem('pp:filtros', JSON.stringify(p)); } catch { /* armazenamento indisponível */ }
}

async function executar(botao, fn) {
  const original = botao?.innerHTML;
  if (botao) { botao.disabled = true; botao.setAttribute('aria-busy', 'true'); botao.innerHTML = `${LOADER} ${esc(botao.textContent.trim())}`; }
  try { return await fn(); } catch (e) { avisar(e.message, true); return undefined; } finally {
    if (botao && botao.isConnected) { botao.disabled = false; botao.removeAttribute('aria-busy'); botao.innerHTML = original; }
  }
}

const dadosForm = (form) => Object.fromEntries(new FormData(form).entries());

/** Contagem animada (count-up) em todo [data-contar] dentro de `raiz`. data-formato: moeda | inteiro | decimal. */
function contar(raiz = main) {
  const formatos = { moeda: (v) => dec(v), inteiro: (v) => num(Math.round(v), 0), decimal: (v) => dec(v) };
  for (const el of $$('[data-contar]', raiz)) {
    const alvo = Number(el.dataset.contar);
    const fmt = formatos[el.dataset.formato || 'inteiro'];
    const de = Number(el.dataset.de || 0);
    if (!Number.isFinite(alvo)) continue;
    if (reduzMovimento() || alvo === de) { el.textContent = fmt(alvo); continue; }
    const inicio = performance.now();
    const duracao = 750;
    const quadro = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const suave = 1 - (1 - t) ** 3;
      el.textContent = fmt(de + (alvo - de) * suave);
      if (t < 1 && el.isConnected) requestAnimationFrame(quadro);
      else el.textContent = fmt(alvo);
    };
    requestAnimationFrame(quadro);
  }
}

// ------------------------------------------------------------------ login (só quando publicado com USUARIOS)

function telaLogin() {
  document.title = 'Entrar — Banco de Preços LS';
  $('#status-catalogo').textContent = '';
  $('#sessao').textContent = '';
  $('#status-backup').textContent = '';
  main.innerHTML = `
    <section class="login painel slide-up" aria-labelledby="t-login">
      <span class="overline overline--ambar">Acesso da equipe</span>
      <h1 id="t-login">Entrar</h1>
      <form id="form-login" class="campos">
        <div class="campo campo--largo"><label for="l-usuario">Usuário</label><input id="l-usuario" name="usuario" required autocomplete="username" autocapitalize="none"></div>
        <div class="campo campo--largo"><label for="l-senha">Senha</label><input id="l-senha" name="senha" type="password" required autocomplete="current-password"></div>
        <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">Entrar ${IC.seta}</button></div>
      </form>
    </section>`;
  $('#l-usuario').focus();
  $('#form-login').addEventListener('submit', (ev) => {
    ev.preventDefault();
    executar(ev.submitter, async () => {
      await api('/login', { method: 'POST', body: dadosForm(ev.target) });
      iniciar();
    });
  });
}

function mostrarSessao(usuario) {
  const el = $('#sessao');
  el.innerHTML = `<span class="mono">${esc(usuario)}</span><button type="button" class="btn btn--secundario btn--pequeno" id="btn-sair">Sair</button>`;
  $('#btn-sair').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    telaLogin();
  });
}

// ------------------------------------------------------------------ catálogo (cabeçalho) e backup (rodapé)

let pollCatalogo;
async function atualizarStatusCatalogo() {
  const el = $('#status-catalogo');
  try {
    const s = await api('/catalogo/status');
    clearTimeout(pollCatalogo);
    if (s.emAndamento) {
      el.innerHTML = `${LOADER} <span>Indexando catálogo oficial (${esc(s.progresso || '…')})</span>`;
      pollCatalogo = setTimeout(atualizarStatusCatalogo, 2000);
      return;
    }
    const tem = s.materiais || s.servicos;
    const quando = s.atualizadoEm ? diaMes(s.atualizadoEm) : null;
    let selo;
    if (s.erro && tem) selo = `<span class="selo selo--ambar" title="${esc(s.erro)}">sem conexão — catálogo local de ${esc(quando || '—')}</span>`;
    else if (s.erro) selo = `<span class="selo selo--cobre" title="${esc(s.erro)}">catálogo indisponível</span>`;
    else if (tem) selo = `<span class="selo selo--musgo">catálogo de ${esc(quando || '—')}</span>`;
    else selo = '<span class="selo selo--ambar">catálogo não baixado</span>';
    el.innerHTML = `${selo}
      ${tem ? `<span class="mono">${num(s.materiais, 0)} materiais · ${num(s.servicos, 0)} serviços</span>` : ''}
      <button type="button" class="btn btn--fantasma btn--pequeno" id="btn-catalogo">${tem ? 'Atualizar' : 'Baixar catálogo'}</button>`;
    $('#btn-catalogo').addEventListener('click', async () => {
      await api('/catalogo/atualizar', { method: 'POST' }).catch((e) => avisar(e.message, true));
      atualizarStatusCatalogo();
    });
  } catch {
    el.innerHTML = '<span class="selo selo--cobre">servidor indisponível</span>';
  }
}

async function atualizarStatusBackup() {
  const el = $('#status-backup');
  try {
    const b = await api('/backups');
    el.innerHTML = `<span>${b.ultimo ? `Último backup: <span class="mono">${esc(diaHora(b.ultimo.data))}</span> · ${plural(b.total, 'cópia', 'cópias')} (máx. ${b.retencao})` : 'Nenhum backup ainda — é feito sozinho antes de gerar o mapa, exportar ou excluir.'}</span>
      <button type="button" class="btn btn--fantasma btn--pequeno" id="btn-backup">Fazer backup agora</button>`;
    $('#btn-backup').addEventListener('click', (ev) => executar(ev.currentTarget, async () => {
      const r = await api('/backups', { method: 'POST' });
      avisar(r.criado ? `Backup criado: ${r.nome}` : r.motivo === 'banco em memória' ? 'Banco em memória: não há arquivo para copiar.' : 'Já existe um backup feito há menos de um minuto.');
      atualizarStatusBackup();
    }));
  } catch { el.textContent = ''; }
}

// ------------------------------------------------------------------ roteamento

const rotas = [
  [/^#?\/?$/, () => telaInicio()],
  [/^#\/nova$/, () => telaNova()],
  [/^#\/pesquisa\/(\d+)$/, (m) => telaPesquisa(Number(m[1]))],
  [/^#\/pesquisa\/(\d+)\/mapa$/, (m) => { location.replace(`/api/pesquisas/${m[1]}/mapa`); }],
  [/^#\/item\/(\d+)$/, (m) => telaItem(Number(m[1]))],
];

async function rotear() {
  const hash = location.hash || '#/';
  $('#dialogo').open && $('#dialogo').close();
  for (const [re, fn] of rotas) {
    const m = hash.match(re);
    if (m) {
      main.innerHTML = `<div class="carregando-tela" role="status">${LOADER.replace('class="loader"', 'class="loader loader--grande"')}<span>Carregando…</span></div>`;
      try { await fn(m); } catch (e) {
        main.innerHTML = `<div class="nota nota--cobre" role="alert">${esc(e.message)}</div><p class="secao"><a class="btn btn--secundario" href="#/">${IC.voltar} Voltar ao início</a></p>`;
      }
      main.focus({ preventScroll: true });
      scrollTo(0, 0);
      return;
    }
  }
  main.innerHTML = `<div class="vazio"><h3>Página não encontrada</h3><p><a href="#/">Ir para o início</a></p></div>`;
}

// ------------------------------------------------------------------ tela: início

function situacaoPesquisa(p) {
  if (!p.total_itens) return '<span class="selo selo--ambar">sem itens</span>';
  if (p.itens_insuficientes) return `<span class="selo selo--ambar">pendente · ${plural(p.itens_insuficientes, 'item', 'itens')} &lt; 3 preços</span>`;
  return '<span class="selo selo--musgo">completa</span>';
}

async function telaInicio() {
  document.title = 'Banco de Preços LS';
  const lista = await api('/pesquisas');
  const soma = (k) => lista.reduce((s, p) => s + (p[k] || 0), 0);
  main.innerHTML = `
    <section class="inicio">
      <div class="inicio__texto">
        <span class="overline overline--ambar fade-in">Pesquisa de preços · Lei 14.133/2021 · IN SEGES/ME 65/2021</span>
        <h1 class="slide-up">Preço de referência com <em>lastro</em>, do catálogo ao mapa.</h1>
        <p class="fade-in atraso-1">Colete preços praticados no Compras.gov.br e no PNCP, trate os valores discrepantes por critério objetivo, registre cada justificativa e saia com o mapa de preços pronto para o processo.</p>
        <div class="botoes fade-in atraso-2">
          <a class="btn btn--primario ${lista.length ? '' : 'pulse-acento'}" href="#/nova" id="btn-nova">${IC.mais} Nova pesquisa</a>
          ${lista.length ? `<a class="btn btn--fantasma" href="#t-lista">Ver pesquisas ${IC.seta}</a>` : ''}
        </div>
        <ol class="passos fade-in atraso-3" aria-label="Como funciona">
          <li><strong>Defina o objeto</strong>Assistente em etapas: objeto, processo, responsável e critérios.</li>
          <li><strong>Colete e trate</strong>Preços oficiais, exclusão de discrepantes e justificativas por amostra.</li>
          <li><strong>Emita o mapa</strong>PDF com quadro-resumo, gráficos, declaração e anexos; CSV para planilha.</li>
        </ol>
      </div>
      <dl class="razao slide-up atraso-2" aria-label="Indicadores gerais">
        <div><dt>Pesquisas</dt><dd><span data-contar="${lista.length}">0</span></dd></div>
        <div><dt>Itens</dt><dd><span data-contar="${soma('total_itens')}">0</span></dd></div>
        <div><dt>Amostras válidas</dt><dd><span data-contar="${soma('total_validas')}">0</span></dd></div>
        <div class="razao__total"><dt>Valor total estimado</dt><dd>R$ <span data-contar="${soma('totalGeral')}" data-formato="moeda">0,00</span></dd></div>
      </dl>
    </section>
    <section class="secao" aria-labelledby="t-lista">
      <div class="secao__topo">
        <div><span class="overline">Arquivo</span><h2 id="t-lista" tabindex="-1">Pesquisas</h2></div>
        ${lista.length > 4 ? `<div class="busca-inline">${IC.lupa}<label class="oculto-visual" for="busca-pesq">Buscar pesquisa</label><input id="busca-pesq" type="search" placeholder="Buscar por objeto, processo ou órgão" autocomplete="off"></div>` : ''}
      </div>
      ${lista.length ? `<div class="tabela-wrap"><table class="tabela--fichas">
        <thead><tr><th>Objeto</th><th>Processo</th><th class="num">Itens</th><th class="num">Amostras</th><th>Situação</th><th class="num">Valor estimado</th><th>Atualizada</th></tr></thead>
        <tbody id="lista-pesquisas">${lista.map((p) => `<tr data-busca="${esc(semAcento(`${p.titulo} ${p.processo || ''} ${p.orgao || ''} ${p.responsavel || ''}`))}">
          <td class="desc"><a href="#/pesquisa/${p.id}">${esc(p.titulo)}</a><small>${esc(p.orgao || 'órgão não informado')}</small></td>
          <td class="mono" data-rotulo="Processo">${esc(p.processo || '—')}</td>
          <td class="num" data-rotulo="Itens">${p.total_itens}</td>
          <td class="num" data-rotulo="Amostras">${p.total_validas}<small>de ${p.total_amostras}</small></td>
          <td data-rotulo="Situação">${situacaoPesquisa(p)}</td>
          <td class="num" data-rotulo="Valor estimado">${moeda(p.totalGeral)}</td>
          <td class="mono pequeno secundario" data-rotulo="Atualizada">${esc(diaHora(doBanco(p.atualizado_em)))}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="vazio" id="lista-vazia" hidden>Nenhuma pesquisa corresponde à busca.</p>`
    : `<div class="vazio painel"><h3>Nenhuma pesquisa ainda</h3><p>Comece pelo assistente: em quatro etapas a pesquisa fica pronta para receber itens.</p></div>`}
    </section>`;
  contar();
  $('#busca-pesq')?.addEventListener('input', (ev) => {
    const q = semAcento(ev.target.value.trim());
    let visiveis = 0;
    for (const tr of $$('#lista-pesquisas tr')) { tr.hidden = !tr.dataset.busca.includes(q); if (!tr.hidden) visiveis++; }
    $('#lista-vazia').hidden = visiveis > 0;
  });
  $('a[href="#t-lista"]')?.addEventListener('click', (ev) => { ev.preventDefault(); $('#t-lista').scrollIntoView({ behavior: reduzMovimento() ? 'auto' : 'smooth', block: 'start' }); $('#t-lista').focus({ preventScroll: true }); });
}

// ------------------------------------------------------------------ tela: nova pesquisa (assistente em 4 etapas)

const RASCUNHO = 'bp:rascunho';
const ETAPAS = [
  { nome: 'Objeto', dica: 'O que será contratado', campos: ['titulo'] },
  { nome: 'Processo', dica: 'Autos, órgão e responsável', campos: ['processo', 'orgao', 'responsavel'] },
  { nome: 'Critérios', dica: 'Método e exclusão padrão', campos: ['k', 'inferior', 'superior'] },
  { nome: 'Resumo', dica: 'Conferir e criar', campos: [] },
];
const VALIDAR = {
  titulo: (d) => (d.titulo.trim().length < 10 ? 'Descreva o objeto com ao menos 10 caracteres.' : d.titulo.length > 300 ? 'Máximo de 300 caracteres.' : ''),
  processo: (d) => (d.processo.trim() && !/\d/.test(d.processo) ? 'Informe o número como consta nos autos (ex.: 23.104/2026).' : ''),
  orgao: (d) => (d.orgao.trim().length < 3 ? 'Informe o órgão ou a entidade contratante.' : ''),
  responsavel: (d) => (d.responsavel.trim().length < 3 ? 'Informe quem responde pela pesquisa (assina o mapa).' : /\d/.test(d.responsavel) ? 'O nome não deve conter números.' : ''),
  k: (d) => (!['desvio', 'iqr'].includes(d.criterio) ? '' : !(Number(String(d.k).replace(',', '.')) > 0 && Number(String(d.k).replace(',', '.')) <= 10) ? 'Informe um número maior que 0 e até 10.' : ''),
  inferior: (d) => (d.criterio !== 'mediana' ? '' : !(Number(d.inferior) > 0 && Number(d.inferior) <= 100) ? 'Entre 1 e 100%.' : ''),
  superior: (d) => (d.criterio !== 'mediana' ? '' : !(Number(d.superior) > 0 && Number(d.superior) <= 1000) ? 'Entre 1 e 1000%.' : ''),
};
const criterioDoRascunho = (d) => {
  const n = (v) => Number(String(v).replace(',', '.'));
  if (d.criterio === 'desvio' || d.criterio === 'iqr') return { tipo: d.criterio, k: n(d.k) };
  if (d.criterio === 'mediana') return { tipo: 'mediana', inferior: n(d.inferior) / 100, superior: n(d.superior) / 100 };
  return { tipo: 'nenhum' };
};
function descreverCriterio(c) {
  if (c.tipo === 'desvio') return `Desvio padrão — fora de média ± ${num(c.k ?? 1)} DP`;
  if (c.tipo === 'iqr') return `Amplitude interquartil — ${num(c.k ?? 1.5)} × IQR`;
  if (c.tipo === 'mediana') return `Mediana −${Math.round((c.inferior ?? 0.5) * 100)}% / +${Math.round((c.superior ?? 0.5) * 100)}%`;
  return 'Nenhum (só exclusões manuais justificadas)';
}

async function telaNova() {
  document.title = 'Nova pesquisa — Banco de Preços LS';
  const padrao = { titulo: '', processo: '', orgao: '', responsavel: '', metodo: 'auto', criterio: 'nenhum', k: '1,5', inferior: '50', superior: '50' };
  let d = { ...padrao };
  let etapa = 1;
  try { const salvo = JSON.parse(sessionStorage.getItem(RASCUNHO) || 'null'); if (salvo) { d = { ...padrao, ...salvo.d }; etapa = Math.min(4, Math.max(1, salvo.etapa || 1)); } } catch { /* rascunho ilegível */ }
  const tocados = new Set();
  const guardar = () => { try { sessionStorage.setItem(RASCUNHO, JSON.stringify({ d, etapa })); } catch { /* sem sessionStorage */ } };
  const errosDa = (n) => ETAPAS[n - 1].campos.filter((c) => VALIDAR[c](d));
  const etapaValida = (n) => errosDa(n).length === 0;
  // rascunho restaurado numa etapa adiante só vale se as anteriores estiverem válidas
  while (etapa > 1 && ![...Array(etapa - 1).keys()].every((i) => etapaValida(i + 1))) etapa--;

  main.innerHTML = `
    <nav class="migalha" aria-label="Navegação"><a href="#/">Pesquisas</a><span aria-hidden="true">/</span><span aria-current="page">Nova pesquisa</span></nav>
    <div class="assistente" id="assistente" data-etapa="${etapa}">
      <aside class="assistente__trilho fade-in">
        <span class="overline overline--ambar">Assistente</span>
        <h1>Nova pesquisa de preços</h1>
        <div class="progresso" role="progressbar" aria-label="Progresso da criação" aria-valuemin="1" aria-valuemax="4" aria-valuenow="${etapa}" aria-valuetext="Etapa ${etapa} de 4"><div class="progresso__barra"></div></div>
        <p class="progresso__texto" id="progresso-texto"></p>
        <ol class="etapas" id="etapas"></ol>
      </aside>
      <form class="assistente__corpo" id="form-assistente" novalidate></form>
    </div>`;
  const raiz = $('#assistente');
  const form = $('#form-assistente');

  const campo = (nome, rotulo, { obrig = false, tipo = 'text', max = 300, exemplo = '', ajuda = '', extra = '' } = {}) => `
    <div class="campo campo--largo">
      <div class="campo__linha"><label for="w-${nome}">${rotulo}${obrig ? '<span class="obrig" aria-hidden="true">*</span>' : ' <span class="secundario">(opcional)</span>'}</label>${extra}</div>
      ${tipo === 'textarea'
    ? `<textarea id="w-${nome}" name="${nome}" maxlength="${max}" ${obrig ? 'required aria-required="true"' : ''} aria-describedby="e-${nome}${ajuda ? ` a-${nome}` : ''}" placeholder="${esc(exemplo)}">${esc(d[nome])}</textarea>`
    : `<input id="w-${nome}" name="${nome}" maxlength="${max}" ${obrig ? 'required aria-required="true"' : ''} aria-describedby="e-${nome}${ajuda ? ` a-${nome}` : ''}" placeholder="${esc(exemplo)}" value="${esc(d[nome])}" autocomplete="off">`}
      <span class="campo__erro" id="e-${nome}" aria-live="polite"></span>
      ${ajuda ? `<span class="ajuda" id="a-${nome}">${ajuda}</span>` : ''}
    </div>`;
  const opcoes = (nome, legenda, lista) => `<fieldset class="opcoes campo--largo"><legend>${legenda}</legend>${lista.map(([v, n, desc]) => `
    <label class="opcao"><input type="radio" name="${nome}" value="${v}" ${d[nome] === v ? 'checked' : ''}><span class="opcao__nome">${esc(n)}</span><span class="opcao__desc">${esc(desc)}</span></label>`).join('')}</fieldset>`;
  const parametros = () => `
    <div class="campo" ${['desvio', 'iqr'].includes(d.criterio) ? '' : 'hidden'}><label for="w-k">${d.criterio === 'desvio' ? 'Escore z (nº de desvios padrão)' : 'Multiplicador do IQR'}</label>
      <input id="w-k" name="k" class="mono" inputmode="decimal" value="${esc(d.k)}" aria-describedby="e-k a-k"><span class="campo__erro" id="e-k" aria-live="polite"></span>
      <span class="ajuda" id="a-k">${d.criterio === 'desvio' ? 'Com poucas amostras use 1 a 1,5: com n = 5 o escore z máximo possível é 1,79.' : 'Padrão de Tukey: 1,5.'}</span></div>
    <div class="campo" ${d.criterio === 'mediana' ? '' : 'hidden'}><label for="w-inferior">Abaixo da mediana (%)</label><input id="w-inferior" name="inferior" class="mono" inputmode="numeric" value="${esc(d.inferior)}" aria-describedby="e-inferior"><span class="campo__erro" id="e-inferior" aria-live="polite"></span></div>
    <div class="campo" ${d.criterio === 'mediana' ? '' : 'hidden'}><label for="w-superior">Acima da mediana (%)</label><input id="w-superior" name="superior" class="mono" inputmode="numeric" value="${esc(d.superior)}" aria-describedby="e-superior"><span class="campo__erro" id="e-superior" aria-live="polite"></span></div>`;

  const corpos = {
    1: () => `<span class="overline">Etapa 1 de 4</span><h2>Qual é o objeto da contratação?</h2>
      <p class="secundario">É o título que identifica a pesquisa e encabeça o mapa de preços. Seja específico: quem lê deve entender o que será contratado.</p>
      <div class="campos">${campo('titulo', 'Objeto', { obrig: true, tipo: 'textarea', exemplo: 'Ex.: Aquisição de material de expediente para as unidades escolares', extra: `<span class="contador" id="c-titulo" aria-hidden="true">${d.titulo.length}/300</span>` })}</div>`,
    2: () => `<span class="overline">Etapa 2 de 4</span><h2>Onde a pesquisa será juntada?</h2>
      <p class="secundario">Estes dados aparecem no cabeçalho e no rodapé do mapa. O responsável é quem assina a declaração de conformidade.</p>
      <div class="campos">
        ${campo('orgao', 'Órgão ou entidade', { obrig: true, exemplo: 'Ex.: Prefeitura Municipal de … — Secretaria de …' })}
        ${campo('responsavel', 'Responsável pela pesquisa', { obrig: true, max: 200, exemplo: 'Nome completo de quem assina' })}
        ${campo('processo', 'Nº do processo administrativo', { max: 100, exemplo: 'Ex.: 23.104/2026', ajuda: 'Pode ser preenchido depois, quando os autos forem abertos.' })}
      </div>`,
    3: () => `<span class="overline">Etapa 3 de 4</span><h2>Como os preços serão tratados?</h2>
      <p class="secundario">São os padrões para os itens novos (IN 65/2021, art. 6º). Cada item pode ter o seu próprio método depois.</p>
      <div class="campos">
        ${opcoes('metodo', 'Preço recomendado pelo critério', METODOS)}
        ${opcoes('criterio', 'Exclusão automática de valores discrepantes', CRITERIOS)}
        <div class="campos campo--largo" id="w-parametros">${parametros()}</div>
      </div>`,
    4: () => {
      const linha = (rotulo, valor, ir, classe = '') => `<div><dt>${rotulo}</dt><dd class="${classe}">${valor}</dd><button type="button" class="btn btn--fantasma btn--pequeno" data-ir="${ir}" aria-label="Editar ${esc(rotulo.toLowerCase())}">Editar</button></div>`;
      return `<span class="overline">Etapa 4 de 4</span><h2>Confira antes de criar</h2>
      <p class="secundario">Nada foi gravado ainda. Depois de criar, você adiciona os itens e coleta os preços.</p>
      <dl class="resumo">
        ${linha('Objeto', esc(d.titulo.trim()), 1, 'destaque')}
        ${linha('Órgão', esc(d.orgao.trim()), 2)}
        ${linha('Responsável', esc(d.responsavel.trim()), 2)}
        ${linha('Processo', d.processo.trim() ? `<span class="mono">${esc(d.processo.trim())}</span>` : '<span class="secundario">a informar</span>', 2)}
        ${linha('Preço recomendado', esc(METODOS.find(([v]) => v === d.metodo)[1]), 3)}
        ${linha('Exclusão automática', esc(descreverCriterio(criterioDoRascunho(d))), 3)}
      </dl>`;
    },
  };

  function mostrarErro(nome, forcar = false) {
    const el = $(`#w-${nome}`, form);
    const alvo = $(`#e-${nome}`, form);
    if (!el || !alvo) return;
    const msg = VALIDAR[nome](d);
    const exibir = msg && (forcar || tocados.has(nome));
    alvo.textContent = exibir ? msg : !msg && tocados.has(nome) && String(d[nome]).trim() ? '✓ ok' : '';
    alvo.classList.toggle('campo__ok', !exibir);
    if (exibir) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  }

  function desenharTrilho() {
    raiz.dataset.etapa = etapa;
    const barra = $('.progresso', raiz);
    barra.setAttribute('aria-valuenow', etapa);
    barra.setAttribute('aria-valuetext', `Etapa ${etapa} de 4: ${ETAPAS[etapa - 1].nome}`);
    $('#progresso-texto').textContent = `Etapa ${etapa} de 4 · ${Math.round((etapa / 4) * 100)}%`;
    $('#etapas').innerHTML = ETAPAS.map((e, i) => {
      const n = i + 1;
      const estado = n === etapa ? 'atual' : n < etapa ? 'feita' : 'futura';
      return `<li data-estado="${estado}" ${n === etapa ? 'aria-current="step"' : ''}><span class="etapas__n" aria-hidden="true">${estado === 'feita' ? '✓' : n}</span>
        <button type="button" data-ir="${n}" ${n >= etapa ? 'disabled' : ''}><span class="etapas__nome">${e.nome}<span class="oculto-visual">${estado === 'feita' ? ' — concluída' : estado === 'atual' ? ' — etapa atual' : ''}</span></span><span class="etapas__dica">${e.dica}</span></button></li>`;
    }).join('');
  }

  function desenhar(focar = true) {
    desenharTrilho();
    form.innerHTML = `<div class="slide-up">${corpos[etapa]()}</div>
      <div class="assistente__acoes">
        ${etapa > 1 ? `<button type="button" class="btn btn--secundario" id="w-voltar">${IC.voltar} Voltar</button>` : `<a class="btn btn--fantasma" href="#/">Cancelar</a>`}
        <button type="submit" class="btn btn--primario" id="w-avancar">${etapa === 4 ? 'Criar pesquisa' : 'Avançar'} ${IC.seta}</button>
      </div>`;
    for (const c of ETAPAS[etapa - 1].campos) mostrarErro(c);
    if (focar) (form.querySelector('textarea, input:not([type="radio"]), input:checked') || $('h2', form))?.focus({ preventScroll: true });
    guardar();
  }

  function ir(n) { etapa = n; desenhar(); scrollTo({ top: 0, behavior: reduzMovimento() ? 'auto' : 'smooth' }); }

  form.addEventListener('input', (ev) => {
    const { name, value } = ev.target;
    if (!(name in d)) return;
    d[name] = value;
    if (ev.target.type !== 'radio') tocados.add(name);
    if (name === 'titulo') $('#c-titulo').textContent = `${value.length}/300`;
    if (name === 'criterio') {
      if (value === 'desvio' && d.k === '1,5') d.k = '1';
      if (value === 'iqr') d.k = '1,5';
      $('#w-parametros').innerHTML = parametros();
    }
    if (VALIDAR[name]) mostrarErro(name);
    guardar();
  });
  form.addEventListener('focusout', (ev) => { if (ev.target.name && VALIDAR[ev.target.name]) { tocados.add(ev.target.name); mostrarErro(ev.target.name); } });
  raiz.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ir]');
    if (b && !b.disabled) ir(Number(b.dataset.ir));
    if (ev.target.closest('#w-voltar')) ir(etapa - 1);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erros = errosDa(etapa);
    if (erros.length) {
      for (const c of ETAPAS[etapa - 1].campos) mostrarErro(c, true);
      $(`#w-${erros[0]}`, form)?.focus();
      return;
    }
    if (etapa < 4) { ir(etapa + 1); return; }
    await executar($('#w-avancar'), async () => {
      const p = await api('/pesquisas', { method: 'POST', body: { titulo: d.titulo, processo: d.processo, orgao: d.orgao, responsavel: d.responsavel, metodoPadrao: d.metodo, criterioPadrao: criterioDoRascunho(d) } });
      try { sessionStorage.removeItem(RASCUNHO); } catch { /* sem sessionStorage */ }
      avisar('Pesquisa criada. Adicione o primeiro item.');
      location.hash = `#/pesquisa/${p.id}`;
    });
  });
  desenhar();
}

// ------------------------------------------------------------------ tela: pesquisa (itens)

function situacaoItem(it) {
  const n = it.estimativa.resumo.n;
  if (!it.amostras.length) return { ordem: 0, html: '<span class="selo selo--ambar">sem amostras</span>' };
  if (n < 3) return { ordem: 1, html: `<span class="selo selo--ambar">pendente · ${n} de 3</span>` };
  return { ordem: 2, html: '<span class="selo selo--musgo">completo</span>' };
}

const COLUNAS_ITENS = [
  ['n', '#', 'num col-n', (it) => it._n],
  ['descricao', 'Descrição', '', (it) => semAcento(it.descricao)],
  ['unidade', 'Unid.', '', (it) => semAcento(it.unidade || '')],
  ['quantidade', 'Qtd.', 'num', (it) => it.quantidade],
  ['amostras', 'Amostras válidas', 'num', (it) => it.estimativa.resumo.n],
  ['recomendado', 'Preço recomendado', 'num', (it) => it.estimativa.valor],
  ['total', 'Total', 'num', (it) => it.total],
  ['situacao', 'Situação', '', (it) => situacaoItem(it).ordem],
];

async function telaPesquisa(id) {
  let p = await api(`/pesquisas/${id}`);
  document.title = `${p.titulo} — Banco de Preços LS`;
  const estado = { busca: '', coluna: 'n', dir: 1, sel: new Set() };

  main.innerHTML = `
    <nav class="migalha" aria-label="Navegação"><a href="#/">Pesquisas</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.titulo.length > 60 ? `${p.titulo.slice(0, 58)}…` : p.titulo)}</span></nav>
    <header class="cabecalho fade-in">
      <div><span class="overline overline--ambar" id="p-over"></span><h1 id="p-titulo"></h1></div>
      <div class="botoes">
        <a class="btn btn--primario" href="/api/pesquisas/${p.id}/mapa" id="btn-mapa">${IC.doc} Gerar mapa de preços</a>
        <a class="btn btn--secundario" href="/api/pesquisas/${p.id}/csv" download id="btn-csv">${IC.baixar} Exportar CSV</a>
      </div>
    </header>
    <dl class="indicadores slide-up" id="p-indicadores"></dl>
    <section class="secao" aria-labelledby="t-itens">
      <div class="secao__topo">
        <div><span class="overline">Composição</span><h2 id="t-itens">Itens</h2></div>
        <div class="busca-inline">${IC.lupa}<label class="oculto-visual" for="busca-itens">Buscar item</label><input id="busca-itens" type="search" placeholder="Buscar por descrição, unidade ou código" autocomplete="off"></div>
        <div class="campo ordenar-movel"><label for="ordenar-movel">Ordenar por</label><select id="ordenar-movel">${COLUNAS_ITENS.flatMap(([k, nome]) => [[`${k}:1`, `${nome === '#' ? 'Ordem original' : nome} ↑`], [`${k}:-1`, `${nome === '#' ? 'Ordem original' : nome} ↓`]]).map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select></div>
        <span class="contagem" id="contagem" role="status" aria-live="polite"></span>
      </div>
      <div id="tabela-itens"></div>
    </section>
    <div class="duas secao">
      <section class="painel" aria-labelledby="t-add">
        <span class="overline">Novo</span><h2 id="t-add">Adicionar item</h2>
        <form id="form-item" class="campos" novalidate>
          <div class="campo campo--largo"><label for="i-desc">Descrição<span class="obrig" aria-hidden="true">*</span></label><textarea id="i-desc" name="descricao" required maxlength="2000" aria-describedby="e-i-desc" placeholder="Ex.: Cadeira de escritório giratória com braços"></textarea><span class="campo__erro" id="e-i-desc" aria-live="polite"></span></div>
          <div class="campo"><label for="i-tipo">Tipo</label><select id="i-tipo" name="tipo"><option value="material">Material</option><option value="servico">Serviço</option></select></div>
          <div class="campo"><label for="i-qtd">Quantidade<span class="obrig" aria-hidden="true">*</span></label><input id="i-qtd" name="quantidade" type="number" min="0.0001" step="any" value="1" required aria-describedby="e-i-qtd"><span class="campo__erro" id="e-i-qtd" aria-live="polite"></span></div>
          <div class="campo"><label for="i-un">Unidade</label><input id="i-un" name="unidade" maxlength="60" placeholder="UN, CX, KG…"></div>
          <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">${IC.mais} Adicionar e coletar preços</button>
            <span class="ajuda" id="padroes-item"></span></div>
        </form>
      </section>
      <section aria-labelledby="t-dados">
        <span class="overline">Cadastro</span><h2 id="t-dados">Dados da pesquisa</h2>
        <details><summary>Editar objeto, processo e responsável</summary>
          <div class="details__corpo"><form id="form-pesq" class="campos">
            <div class="campo campo--largo"><label for="p-tit">Objeto<span class="obrig" aria-hidden="true">*</span></label><input id="p-tit" name="titulo" required maxlength="300" value="${esc(p.titulo)}"></div>
            <div class="campo"><label for="p-proc">Nº do processo</label><input id="p-proc" name="processo" maxlength="100" value="${esc(p.processo || '')}"></div>
            <div class="campo"><label for="p-resp">Responsável</label><input id="p-resp" name="responsavel" maxlength="200" value="${esc(p.responsavel || '')}"></div>
            <div class="campo campo--largo"><label for="p-org">Órgão</label><input id="p-org" name="orgao" maxlength="300" value="${esc(p.orgao || '')}"></div>
            <div class="botoes campo--largo"><button class="btn btn--secundario" type="submit">Salvar dados</button></div>
          </form></div>
        </details>
        <details><summary>Excluir esta pesquisa</summary>
          <div class="details__corpo"><p class="ajuda">Apaga a pesquisa com todos os itens e amostras. Uma cópia de segurança do banco é feita antes.</p>
            <p class="botoes"><button class="btn btn--perigo" type="button" id="btn-excluir-pesq">${IC.lixo} Excluir pesquisa</button></p></div>
        </details>
      </section>
    </div>
    <div class="lote" id="lote" role="region" aria-label="Seleção em lote" hidden>
      <span class="lote__texto" id="lote-texto" role="status" aria-live="polite"></span>
      <button type="button" class="btn btn--fantasma btn--pequeno" id="lote-limpar">Limpar seleção</button>
      <button type="button" class="btn btn--perigo btn--pequeno" id="lote-excluir">${IC.lixo} Excluir selecionados</button>
    </div>`;

  function desenharCabecalho() {
    $('#p-over').textContent = [p.processo ? `Processo ${p.processo}` : 'Processo a informar', p.orgao].filter(Boolean).join(' · ');
    $('#p-titulo').textContent = p.titulo;
    const validas = p.itens.reduce((s, i) => s + i.estimativa.resumo.n, 0);
    const coletadas = p.itens.reduce((s, i) => s + i.amostras.length, 0);
    const pend = p.itens.filter((i) => i.estimativa.resumo.n < 3).length;
    $('#p-indicadores').innerHTML = `
      <div class="indicador"><dt>Itens</dt><dd><span data-contar="${p.itens.length}">0</span></dd></div>
      <div class="indicador"><dt>Amostras válidas</dt><dd><span data-contar="${validas}">0</span> <small>de ${coletadas}</small></dd></div>
      <div class="indicador ${pend ? 'indicador--alerta' : ''}"><dt>Itens com menos de 3 preços</dt><dd><span data-contar="${pend}">0</span></dd></div>
      <div class="indicador indicador--acento"><dt>Valor total estimado</dt><dd>R$ <span data-contar="${p.totalGeral}" data-formato="moeda">0,00</span></dd></div>`;
    contar($('#p-indicadores'));
    $('#padroes-item').textContent = `Padrão desta pesquisa: ${METODOS.find(([v]) => v === p.metodo_padrao)?.[1] || 'Automático'} · ${NOME_CRITERIO[p.criterio_padrao?.tipo] || 'Nenhum'}`;
  }

  function itensVisiveis() {
    const q = semAcento(estado.busca.trim());
    const col = COLUNAS_ITENS.find(([k]) => k === estado.coluna);
    const lista = p.itens.map((it, i) => ({ ...it, _n: i + 1 }))
      .filter((it) => !q || semAcento(`${it.descricao} ${it.unidade || ''} ${it.codigo || ''} ${it.codigo_tipo || ''}`).includes(q));
    lista.sort((a, b) => {
      const va = col[3](a); const vb = col[3](b);
      // sem valor (item sem preço) vai sempre para o fim, em qualquer direção
      if (va === null || va === undefined) return vb === null || vb === undefined ? a._n - b._n : 1;
      if (vb === null || vb === undefined) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR', { numeric: true }) : va - vb;
      return (c || a._n - b._n) * (c ? estado.dir : 1);
    });
    return lista;
  }

  function desenharLote() {
    const n = estado.sel.size;
    $('#lote').hidden = n === 0;
    if (n) $('#lote-texto').innerHTML = `<strong>${n}</strong> ${n === 1 ? 'item selecionado' : 'itens selecionados'}`;
  }

  function desenharTabela() {
    const lista = itensVisiveis();
    $('#contagem').textContent = p.itens.length ? `${lista.length} de ${plural(p.itens.length, 'item', 'itens')}` : '';
    $('#ordenar-movel').value = `${estado.coluna}:${estado.dir}`;
    if (!p.itens.length) {
      $('#tabela-itens').innerHTML = '<div class="vazio painel"><h3>Nenhum item ainda</h3><p>Adicione o primeiro item abaixo. Em seguida você busca os preços praticados para ele.</p></div>';
      desenharLote();
      return;
    }
    const todosMarcados = lista.length > 0 && lista.every((it) => estado.sel.has(it.id));
    $('#tabela-itens').innerHTML = `<div class="tabela-wrap"><table class="tabela--fichas">
      <thead><tr>
        <th class="col-sel"><input type="checkbox" id="sel-todos" aria-label="Selecionar todos os itens visíveis" ${todosMarcados ? 'checked' : ''} ${lista.length ? '' : 'disabled'}></th>
        ${COLUNAS_ITENS.map(([k, nome, classe]) => `<th class="${classe}" scope="col" aria-sort="${estado.coluna === k ? (estado.dir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="th-ordenar" data-col="${k}">${nome}</button></th>`).join('')}
      </tr></thead>
      <tbody>${lista.map((it) => `<tr class="${estado.sel.has(it.id) ? 'selecionada' : ''}" data-id="${it.id}">
        <td class="col-sel"><input type="checkbox" class="sel-item" value="${it.id}" aria-label="Selecionar item ${it._n}: ${esc(it.descricao.slice(0, 60))}" ${estado.sel.has(it.id) ? 'checked' : ''}></td>
        <td class="num col-n secundario" data-rotulo="Nº">${it._n}</td>
        <td class="desc"><a href="#/item/${it.id}">${esc(it.descricao)}</a>
          <small class="mono">${it.codigo ? `${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)}` : 'sem código do catálogo'}</small></td>
        <td data-rotulo="Unidade">${esc(it.unidade || '—')}</td>
        <td class="num" data-rotulo="Quantidade">${num(it.quantidade, 4)}</td>
        <td class="num" data-rotulo="Amostras válidas">${it.estimativa.resumo.n}<small>de ${it.amostras.length}</small></td>
        <td class="num" data-rotulo="Preço recomendado"><strong>${moeda(it.estimativa.valor)}</strong><small>${esc(NOME_METODO[it.estimativa.metodoAplicado] || '—')}</small></td>
        <td class="num" data-rotulo="Total">${moeda(it.total)}</td>
        <td data-rotulo="Situação">${situacaoItem(it).html}</td></tr>`).join('') || `<tr><td colspan="9" class="vazio sem-rotulo">Nenhum item corresponde a “${esc(estado.busca)}”.</td></tr>`}
      </tbody>
      <tfoot><tr><td colspan="7" class="num overline">Valor total estimado</td><td class="num">${moeda(p.totalGeral)}</td><td></td></tr></tfoot>
    </table></div>`;
    const todos = $('#sel-todos');
    if (todos) todos.indeterminate = !todosMarcados && lista.some((it) => estado.sel.has(it.id));
    desenharLote();
  }

  desenharCabecalho();
  desenharTabela();

  $('#busca-itens').addEventListener('input', (ev) => { estado.busca = ev.target.value; desenharTabela(); });
  // no celular a tabela vira fichas e o cabeçalho some: a ordenação fica neste seletor
  $('#ordenar-movel').addEventListener('change', (ev) => { const [col, dir] = ev.target.value.split(':'); estado.coluna = col; estado.dir = Number(dir); desenharTabela(); });
  $('#tabela-itens').addEventListener('click', (ev) => {
    const b = ev.target.closest('.th-ordenar');
    if (!b) return;
    if (estado.coluna === b.dataset.col) estado.dir *= -1; else { estado.coluna = b.dataset.col; estado.dir = 1; }
    desenharTabela();
    $(`.th-ordenar[data-col="${estado.coluna}"]`)?.focus();
  });
  $('#tabela-itens').addEventListener('change', (ev) => {
    if (ev.target.id === 'sel-todos') {
      for (const it of itensVisiveis()) { if (ev.target.checked) estado.sel.add(it.id); else estado.sel.delete(it.id); }
      desenharTabela();
      $('#sel-todos')?.focus();
    } else if (ev.target.classList.contains('sel-item')) {
      const iid = Number(ev.target.value);
      if (ev.target.checked) estado.sel.add(iid); else estado.sel.delete(iid);
      ev.target.closest('tr').classList.toggle('selecionada', ev.target.checked);
      const lista = itensVisiveis();
      const todos = $('#sel-todos');
      todos.checked = lista.every((it) => estado.sel.has(it.id));
      todos.indeterminate = !todos.checked && lista.some((it) => estado.sel.has(it.id));
      desenharLote();
    }
  });
  $('#lote-limpar').addEventListener('click', () => { estado.sel.clear(); desenharTabela(); });
  $('#lote-excluir').addEventListener('click', async (ev) => {
    const ids = [...estado.sel];
    const nomes = p.itens.filter((it) => estado.sel.has(it.id)).map((it) => it.descricao);
    const amostras = p.itens.filter((it) => estado.sel.has(it.id)).reduce((s, it) => s + it.amostras.length, 0);
    const ok = await dialogo({
      titulo: `Excluir ${plural(ids.length, 'item', 'itens')}?`,
      texto: `Serão apagados <strong>${plural(ids.length, 'item', 'itens')}</strong> e <strong>${plural(amostras, 'amostra', 'amostras')}</strong>: ${esc(nomes.slice(0, 3).map((n) => (n.length > 48 ? `${n.slice(0, 46)}…` : n)).join('; '))}${nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ''}.<br><br>Uma cópia de segurança do banco é feita antes; se ela falhar, nada é excluído.`,
      confirmar: `Excluir ${plural(ids.length, 'item', 'itens')}`, perigo: true,
    });
    if (!ok) return;
    await executar(ev.currentTarget, async () => {
      const r = await api(`/pesquisas/${id}/itens/excluir-lote`, { method: 'POST', body: { ids } });
      p = r.pesquisa;
      estado.sel.clear();
      desenharCabecalho();
      desenharTabela();
      atualizarStatusBackup();
      avisar(`${plural(r.excluidos, 'item excluído', 'itens excluídos')}.${r.backup ? ` Cópia de segurança: ${r.backup}` : ''}`);
    });
  });

  $('#form-item').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    const erros = { 'i-desc': f.descricao.trim().length < 3 ? 'Descreva o item (ao menos 3 caracteres).' : '', 'i-qtd': Number(f.quantidade) > 0 ? '' : 'Informe uma quantidade maior que zero.' };
    for (const [campoId, msg] of Object.entries(erros)) {
      $(`#e-${campoId}`).textContent = msg;
      if (msg) $(`#${campoId}`).setAttribute('aria-invalid', 'true'); else $(`#${campoId}`).removeAttribute('aria-invalid');
    }
    const primeiro = Object.entries(erros).find(([, m]) => m);
    if (primeiro) { $(`#${primeiro[0]}`).focus(); return; }
    await executar(ev.submitter, async () => {
      const it = await api(`/pesquisas/${id}/itens`, { method: 'POST', body: f });
      location.hash = `#/item/${it.id}`;
    });
  });
  $('#form-pesq').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, async () => {
      p = await api(`/pesquisas/${id}`, { method: 'PUT', body: dadosForm(ev.target) });
      document.title = `${p.titulo} — Banco de Preços LS`;
      desenharCabecalho();
      avisar('Dados salvos.');
    });
  });
  $('#btn-excluir-pesq').addEventListener('click', async () => {
    const ok = await dialogo({ titulo: 'Excluir a pesquisa inteira?', texto: `“${esc(p.titulo)}” será apagada com <strong>${plural(p.itens.length, 'item', 'itens')}</strong> e todas as amostras. Uma cópia de segurança é feita antes.`, confirmar: 'Excluir pesquisa', perigo: true });
    if (!ok) return;
    try { await api(`/pesquisas/${id}`, { method: 'DELETE' }); avisar('Pesquisa excluída.'); atualizarStatusBackup(); location.hash = '#/'; } catch (e) { avisar(e.message, true); }
  });
  // backup é feito no servidor ao gerar o mapa / exportar: atualiza o rodapé logo depois
  for (const b of ['#btn-mapa', '#btn-csv']) $(b).addEventListener('click', () => setTimeout(atualizarStatusBackup, 1500));
}

// ------------------------------------------------------------------ tela: item (resultados)

/** Faixa de dispersão: cada amostra é um ponto no eixo de preços; faixa admitida pelo critério e marca do recomendado. */
function svgFaixa(it) {
  const L = 640; const A = 78; const m = 14; const y = 40;
  const precos = it.amostras.map((a) => a.preco_unitario);
  if (!precos.length) return '';
  let min = Math.min(...precos); let max = Math.max(...precos);
  if (max === min) { min -= Math.max(1, min * 0.1); max += Math.max(1, max * 0.1); }
  const folga = (max - min) * 0.04;
  min -= folga; max += folga;
  const x = (v) => m + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (L - 2 * m);
  const partes = [`<line x1="${m}" y1="${y}" x2="${L - m}" y2="${y}" stroke="#475569" stroke-width="1"/>`];
  if (it.limites?.aplicavel) {
    const x1 = x(it.limites.min); const x2 = x(it.limites.max);
    partes.push(`<rect x="${x1.toFixed(1)}" y="${y - 13}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="26" rx="3" fill="#15803d" fill-opacity=".22" stroke="#22a355" stroke-opacity=".5" stroke-width="1"/>`);
  }
  const vistos = new Map();
  it.amostras.forEach((a) => {
    const cx = x(a.preco_unitario);
    const chave = Math.round(cx / 7);
    const k = vistos.get(chave) || 0;
    vistos.set(chave, k + 1);
    const cy = y + [0, -8, 8, -15, 15][k % 5]; // empilha pontos coincidentes
    partes.push(a.incluida
      ? `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="4.2" fill="#f8fafc" fill-opacity=".92" stroke="#0a0e14" stroke-width="1"/>`
      : `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="4.2" fill="#0a0e14" stroke="#cf7a3d" stroke-width="1.6"/><path d="M${(cx - 2.2).toFixed(1)} ${cy - 2.2}l4.400 4.400m0-4.400l-4.400 4.400" stroke="#cf7a3d" stroke-width="1.1"/>`);
  });
  const menor = Math.min(...precos); const maior = Math.max(...precos);
  partes.push(`<text x="${x(menor).toFixed(1)}" y="${A - 4}" text-anchor="start">${dec(menor)}</text>`);
  if (maior !== menor) partes.push(`<text x="${x(maior).toFixed(1)}" y="${A - 4}" text-anchor="end">${dec(maior)}</text>`);
  if (it.estimativa.valor !== null) {
    const xr = x(it.estimativa.valor);
    const ancora = xr < 60 ? 'start' : xr > L - 60 ? 'end' : 'middle';
    partes.push(`<line x1="${xr.toFixed(1)}" y1="14" x2="${xr.toFixed(1)}" y2="${y + 20}" stroke="#d97706" stroke-width="2"/><text class="faixa__rec" x="${xr.toFixed(1)}" y="10" text-anchor="${ancora}">${dec(it.estimativa.valor)}</text>`);
  }
  const excl = it.amostras.length - it.estimativa.resumo.n;
  return `<svg class="faixa" viewBox="0 0 ${L} ${A}" role="img" aria-label="Dispersão dos preços: ${it.amostras.length} amostras de ${dec(menor)} a ${dec(maior)} reais, ${excl} desconsiderada(s); recomendado ${dec(it.estimativa.valor)}.">${partes.join('')}</svg>
    <p class="legenda-faixa" aria-hidden="true"><span><i></i>considerada</span><span><i class="l-exc"></i>desconsiderada</span><span><i class="l-rec"></i>recomendado</span>${it.limites?.aplicavel ? '<span><i class="l-adm"></i>faixa admitida pelo critério</span>' : ''}</p>`;
}

function htmlVeredito(it, anterior) {
  const e = it.estimativa;
  const r = e.resumo;
  const excl = it.amostras.length - r.n;
  const auto = it.metodo === 'auto';
  if (!it.amostras.length) {
    return `<div class="recomendado recomendado--vazio"><span class="overline">Preço recomendado</span><p class="recomendado__valor">—</p>
        <p class="secundario">Ainda não há amostras. Identifique o item no catálogo e busque os preços praticados logo abaixo.</p></div>
      <div class="criterio"><div class="nota nota--neutra">A IN SEGES/ME 65/2021 pede, em regra, ao menos <strong>3 preços</strong> válidos por item (art. 6º, § 5º). Com menos que isso é preciso justificar nos autos.</div></div>`;
  }
  return `
    <div class="recomendado ${e.insuficiente ? '' : 'cartao--vivo'}" id="cartao-recomendado">
      <div class="recomendado__topo"><span class="overline overline--ambar">Preço recomendado</span>
        ${e.insuficiente ? `<span class="selo selo--ambar">pendente · ${r.n} de 3</span>` : '<span class="selo selo--musgo">ativo</span>'}</div>
      <p class="recomendado__valor"><span class="cifra">R$</span><span data-contar="${e.valor ?? ''}" data-de="${anterior ?? 0}" data-formato="moeda">${dec(e.valor)}</span></p>
      <p class="recomendado__metodo"><span class="pulso pulse-acento" aria-hidden="true"></span> ${esc(NOME_METODO[e.metodoAplicado] || '—')} de ${plural(r.n, 'preço válido', 'preços válidos')}${auto ? ' <span class="secundario">· escolha automática</span>' : ''}</p>
      <p class="recomendado__total"><span>Total do item · ${num(it.quantidade, 4)} ${esc(it.unidade || 'un.')}</span><strong>${moeda(it.total)}</strong></p>
    </div>
    <div class="criterio">
      <fieldset class="tiles" id="tiles-metodo">
        <legend class="overline">Critério do preço recomendado</legend>
        ${['media', 'mediana', 'menor'].map((k) => `<label class="tile" data-aplicado="${e.metodoAplicado === k}">
          <input type="radio" name="metodo" value="${k}" ${it.metodo === k ? 'checked' : ''}>
          <span class="tile__nome">${k === 'menor' ? 'Menor' : k === 'media' ? 'Média' : 'Mediana'}</span>
          <span class="tile__valor">${moeda(e.opcoes[k])}</span>
          <span class="tile__tag">◆ recomendado</span></label>`).join('')}
      </fieldset>
      <label class="auto-linha"><input type="checkbox" id="metodo-auto" ${auto ? 'checked' : ''}> Escolher automaticamente (média se CV ≤ 25%; senão, mediana)</label>
      <div>${svgFaixa(it)}</div>
      <dl class="estat">
        <div><dt>Válidas</dt><dd>${r.n} <span class="secundario">de ${it.amostras.length}</span></dd></div>
        <div><dt>Excluídas</dt><dd>${excl}</dd></div>
        <div><dt>Maior</dt><dd>${moeda(r.maior)}</dd></div>
        <div><dt>Desvio padrão</dt><dd>${r.n ? dec(r.desvioPadrao) : '—'}</dd></div>
        <div><dt>Coef. variação</dt><dd>${pct(r.cv)}</dd></div>
      </dl>
    </div>`;
}

function htmlAlertas(it) {
  return it.estimativa.alertas.map((a) => `<div class="nota ${/não aplicado/.test(a) ? 'nota--neutra' : ''}" role="status">${esc(a)}</div>`).join('');
}

function htmlAmostras(it) {
  if (!it.amostras.length) return '<div class="vazio painel"><h3>Nenhuma amostra</h3><p>Busque preços na coleta acima e adicione os compatíveis com o item, ou lance uma cotação manual.</p></div>';
  return `<div class="tabela-wrap"><table class="tabela--fichas">
    <thead><tr><th class="num">Nº</th><th class="num">Preço unit.</th><th>Situação</th><th>Data</th><th>Órgão / local</th><th>Fornecedor</th><th>Ações</th></tr></thead>
    <tbody>${it.amostras.map((a, i) => `<tr class="${a.incluida ? '' : 'excluida'}">
      <td class="num secundario" data-rotulo="Nº">${i + 1}</td>
      <td class="num preco" data-rotulo="Preço unitário"><strong>${moeda(a.preco_unitario)}</strong></td>
      <td data-rotulo="Situação">${a.incluida ? `<span class="selo selo--musgo">${a.manual === 1 ? 'mantida manualmente' : 'considerada'}</span>` : `<span class="selo selo--cobre">excluída${a.manual === 0 ? ' manualmente' : ' pelo critério'}</span>`}
        ${a.motivo || a.justificativa ? `<span class="motivo">${a.motivo ? esc(a.motivo) : ''}${a.justificativa ? `<em>Justificativa: ${esc(a.justificativa)}</em>` : ''}</span>` : ''}</td>
      <td class="mono" data-rotulo="Data"><span>${data(a.data_compra)}</span></td>
      <td class="desc"><span>${esc(a.orgao || NOME_ORIGEM[a.origem] || a.origem)}</span><small>${esc([NOME_ORIGEM[a.origem] || a.origem, [a.municipio, a.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '))}${a.link ? ` · <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">ver fonte ↗</a>` : ''}</small></td>
      <td data-rotulo="Fornecedor"><span>${esc(a.fornecedor_nome || '—')}</span>${a.marca ? `<small>Marca: ${esc(a.marca)}</small>` : ''}</td>
      <td class="sem-rotulo"><div class="botoes">
        ${a.incluida
    ? `<button type="button" class="btn btn--secundario btn--pequeno" data-acao="excluir" data-id="${a.id}" aria-label="Desconsiderar amostra ${i + 1}, ${esc(moeda(a.preco_unitario))}">Desconsiderar</button>`
    : `<button type="button" class="btn btn--secundario btn--pequeno" data-acao="incluir" data-id="${a.id}" aria-label="Reconsiderar amostra ${i + 1}, ${esc(moeda(a.preco_unitario))}">Reconsiderar</button>`}
        ${a.manual !== null ? `<button type="button" class="btn btn--fantasma btn--pequeno" data-acao="auto" data-id="${a.id}" aria-label="Devolver amostra ${i + 1} ao critério automático">Usar critério</button>` : ''}
        ${!a.incluida && a.manual === null ? `<button type="button" class="btn btn--fantasma btn--pequeno" data-acao="justificar" data-id="${a.id}" aria-label="Registrar justificativa da amostra ${i + 1}">${a.justificativa ? 'Editar justificativa' : 'Justificar'}</button>` : ''}
        <button type="button" class="btn btn--fantasma btn--pequeno" data-acao="remover" data-id="${a.id}" aria-label="Remover amostra ${i + 1}, ${esc(moeda(a.preco_unitario))}">Remover</button>
      </div></td></tr>`).join('')}
    </tbody></table></div>`;
}

function htmlParametros(c) {
  const k = c.k ?? (c.tipo === 'iqr' ? 1.5 : 1);
  return `
    <div class="campo" ${['desvio', 'iqr'].includes(c.tipo) ? '' : 'hidden'}><label for="c-k">${c.tipo === 'desvio' ? 'Escore z' : 'Multiplicador do IQR'}</label><input id="c-k" name="k" type="number" min="0.1" max="10" step="0.1" value="${esc(k)}"></div>
    <div class="campo" ${c.tipo === 'mediana' ? '' : 'hidden'}><label for="c-inf">Abaixo (%)</label><input id="c-inf" name="inferior" type="number" min="1" max="100" step="1" value="${esc(Math.round((c.inferior ?? 0.5) * 100))}"></div>
    <div class="campo" ${c.tipo === 'mediana' ? '' : 'hidden'}><label for="c-sup">Acima (%)</label><input id="c-sup" name="superior" type="number" min="1" max="1000" step="1" value="${esc(Math.round((c.superior ?? 0.5) * 100))}"></div>`;
}

/** Selo de origem dos dados de uma fonte: rede, cache válido ou cache vencido (fonte fora do ar). */
function seloCache(f) {
  const c = f.cache;
  if (!c || !c.usado) return `<span class="selo selo--musgo">${esc(f.nome)} · consultado agora</span>`;
  const quando = c.de ? diaMes(c.de) : '—';
  if (c.obsoleto) return `<span class="selo selo--ambar" title="${esc(c.motivo || '')}">${esc(f.nome)} fora do ar · resultado do cache de ${esc(quando)}</span>`;
  return `<span class="selo">${esc(f.nome)} · resultado do cache de ${esc(quando)}${c.de ? `, ${esc(new Date(c.de).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}` : ''}</span>`;
}

async function telaItem(id) {
  let it = await api(`/itens/${id}`);
  const pesquisa = await api(`/pesquisas/${it.pesquisa_id}`);
  const posicao = pesquisa.itens.findIndex((x) => x.id === it.id) + 1;
  document.title = `${it.descricao.slice(0, 60)} — Banco de Preços LS`;
  const pref = preferencias();
  const hoje = new Date();
  const umAno = new Date(hoje); umAno.setFullYear(hoje.getFullYear() - 1);
  const estado = { resultados: [], consulta: null, ultimoValor: 0 };

  main.innerHTML = `
    <nav class="migalha" aria-label="Navegação"><a href="#/">Pesquisas</a><span aria-hidden="true">/</span><a href="#/pesquisa/${pesquisa.id}">${esc(pesquisa.titulo.length > 44 ? `${pesquisa.titulo.slice(0, 42)}…` : pesquisa.titulo)}</a><span aria-hidden="true">/</span><span aria-current="page">Item ${posicao}</span></nav>
    <header class="cabecalho cabecalho--item fade-in">
      <div><span class="overline overline--ambar" id="i-over"></span><h1 id="i-titulo"></h1></div>
      <div class="botoes"><a class="btn btn--secundario" href="#/pesquisa/${pesquisa.id}">${IC.voltar} Voltar à pesquisa</a></div>
    </header>
    <section class="veredito slide-up" id="veredito" aria-label="Resultado do item"></section>
    <div id="alertas" class="secao" aria-live="polite"></div>

    <div id="blocos">
    <section class="secao" id="sec-amostras" aria-labelledby="t-amostras">
      <div class="secao__topo"><div><span class="overline">Preços praticados</span><h2 id="t-amostras">Amostras</h2></div></div>
      <form class="metodo-exclusao" id="form-criterio">
        <div class="grupo-segmentos"><span class="overline" aria-hidden="true">Exclusão de valores discrepantes (art. 6º, § 3º)</span>
        <fieldset class="segmentos"><legend class="oculto-visual">Método de exclusão de valores discrepantes</legend>
          ${CRITERIOS.map(([k, n, desc]) => `<label class="segmento" title="${esc(desc)}"><input type="radio" name="criterio" value="${k}" ${it.criterio.tipo === k ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}
        </fieldset></div>
        <div class="parametros" id="crit-params">${htmlParametros(it.criterio)}</div>
      </form>
      <p class="ajuda" id="crit-desc"></p>
      <div id="lista-amostras"></div>
      <details id="det-trilha"><summary>Trilha de decisões (auditoria)</summary><div class="details__corpo" id="trilha"></div></details>
      <details><summary>Lançar cotação de outra fonte (fornecedor, site, nota fiscal)</summary>
        <div class="details__corpo"><form id="form-manual" class="campos">
          <div class="campo"><label for="m-preco">Preço unitário (R$)<span class="obrig" aria-hidden="true">*</span></label><input id="m-preco" name="precoUnitario" type="number" min="0.0001" step="0.0001" required></div>
          <div class="campo"><label for="m-data">Data<span class="obrig" aria-hidden="true">*</span></label><input id="m-data" name="dataCompra" type="date" required value="${esc(iso(hoje))}"></div>
          <div class="campo"><label for="m-origem">Fonte<span class="obrig" aria-hidden="true">*</span></label><select id="m-origem" name="origem"><option value="cotacao-fornecedor">Cotação com fornecedor (art. 5º, IV)</option><option value="midia-especializada">Mídia/tabela especializada (art. 5º, III)</option><option value="site-eletronico">Site eletrônico (art. 5º, III)</option><option value="contratacao-similar">Contratação similar (art. 5º, II)</option><option value="nota-fiscal">Nota fiscal eletrônica (art. 5º, V)</option></select></div>
          <div class="campo"><label for="m-forn">Fornecedor / fonte</label><input id="m-forn" name="fornecedorNome" maxlength="300"></div>
          <div class="campo"><label for="m-ni">CNPJ/CPF</label><input id="m-ni" name="fornecedorNi" class="mono" maxlength="20"></div>
          <div class="campo"><label for="m-link">Link</label><input id="m-link" name="link" type="url" maxlength="500" placeholder="https://"></div>
          <div class="campo campo--largo"><label for="m-desc">Descrição do produto cotado</label><input id="m-desc" name="descricao" maxlength="4000"></div>
          <div class="botoes campo--largo"><button class="btn btn--secundario" type="submit">${IC.mais} Adicionar cotação</button></div>
        </form></div>
      </details>
    </section>

    <section class="secao" id="sec-coleta" aria-labelledby="t-coleta">
      <div class="secao__topo"><div><span class="overline">Coleta</span><h2 id="t-coleta">Buscar preços praticados</h2></div></div>
      <div class="duas duas--inv">
        <div>
          <h3>1 · Identificar no catálogo oficial</h3>
          <div class="campo"><label for="b-q">Material ou serviço (nome genérico ou código)</label>
            <input id="b-q" type="search" autocomplete="off" placeholder="Ex.: cadeira escritório, gasolina" value="${esc(it.descricao.split(/[,;(]/)[0].slice(0, 60))}" aria-describedby="a-bq">
            <span class="ajuda" id="a-bq">O catálogo usa nomes genéricos (PDM). Escolha o mais próximo e refine pelas palavras-chave.</span></div>
          <div id="escolhido" class="escolhido"></div>
          <ul id="b-res" class="resultados-catalogo" aria-label="Resultados do catálogo"></ul>
          <details><summary>Informar o código CATMAT diretamente</summary>
            <div class="details__corpo"><form id="form-cod" class="campos"><div class="campo"><label for="cod-item">Código do item (CATMAT)</label><input id="cod-item" name="codigo" class="mono" inputmode="numeric" pattern="\\d{3,9}" required></div>
            <div class="botoes campo"><button class="btn btn--secundario" type="submit">Usar este código</button></div></form></div>
          </details>
        </div>
        <div class="painel">
          <h3>2 · Preços no Compras.gov.br e no PNCP</h3>
          <form id="form-precos" class="campos">
            <div class="campo"><label for="p-fonte">Fonte</label><select id="p-fonte" name="fonte">
              ${[['ambas', 'Compras.gov.br + PNCP'], ['compras', 'Compras.gov.br'], ['pncp', 'PNCP']].map(([v, n]) => `<option value="${v}" ${(pref.fonte || 'ambas') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="campo"><label for="p-uf">UF</label><select id="p-uf" name="uf"><option value="">Todas</option>${UFS.map((u) => `<option ${pref.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
            <div class="campo"><label for="p-ini">De</label><input id="p-ini" name="inicio" type="date" value="${esc(iso(umAno))}"></div>
            <div class="campo"><label for="p-fim">Até</label><input id="p-fim" name="fim" type="date" value="${esc(iso(hoje))}"></div>
            <div class="campo campo--largo"><label for="p-pal">Palavras-chave na descrição</label><input id="p-pal" name="palavras" placeholder="Ex.: tinta impressora" aria-describedby="a-pal"><span class="ajuda" id="a-pal">Refinam o resultado; obrigatórias para o PNCP. Período padrão: 12 meses (art. 5º, II).</span></div>
            <div class="botoes campo--largo"><button class="btn btn--primario" type="submit" id="btn-buscar">${IC.lupa.replace('<svg', '<svg class="icone"')} Buscar preços</button>
              <button class="btn btn--fantasma" type="submit" id="btn-atualizar" name="atualizar" value="1" title="Ignora o cache local e consulta a fonte de novo">Atualizar da fonte</button></div>
          </form>
        </div>
      </div>
      <div id="res-precos" class="secao" aria-live="polite"></div>
    </section>
    </div>

    <section class="secao" aria-labelledby="t-config">
      <details><summary id="t-config">Editar descrição, quantidade e observações do item</summary>
        <div class="details__corpo"><form id="form-cfg" class="campos">
          <div class="campo campo--largo"><label for="f-desc">Descrição<span class="obrig" aria-hidden="true">*</span></label><textarea id="f-desc" name="descricao" maxlength="2000" required>${esc(it.descricao)}</textarea></div>
          <div class="campo"><label for="f-qtd">Quantidade</label><input id="f-qtd" name="quantidade" type="number" min="0.0001" step="any" value="${esc(it.quantidade)}" required></div>
          <div class="campo"><label for="f-un">Unidade</label><input id="f-un" name="unidade" maxlength="60" value="${esc(it.unidade || '')}"></div>
          <div class="campo campo--largo"><label for="f-obs">Observações / justificativas gerais (saem no mapa)</label><textarea id="f-obs" name="observacao" maxlength="4000">${esc(it.observacao || '')}</textarea></div>
          <div class="botoes campo--largo"><button class="btn btn--secundario" type="submit">Salvar item</button>
            <button class="btn btn--perigo" type="button" id="btn-excluir-item">${IC.lixo} Excluir item</button></div>
        </form></div>
      </details>
    </section>`;

  const desenhar = () => {
    $('#i-over').textContent = [`Item ${posicao} de ${pesquisa.itens.length}`, it.codigo ? `${(it.codigo_tipo || '').toUpperCase()} ${it.codigo}` : null, `${num(it.quantidade, 4)} ${it.unidade || 'un.'}`].filter(Boolean).join(' · ');
    $('#i-titulo').textContent = it.descricao;
    $('#veredito').innerHTML = htmlVeredito(it, estado.ultimoValor);
    contar($('#veredito'));
    estado.ultimoValor = it.estimativa.valor ?? 0;
    $('#alertas').innerHTML = htmlAlertas(it);
    $('#alertas').hidden = !it.estimativa.alertas.length;
    $('#lista-amostras').innerHTML = htmlAmostras(it);
    const lim = it.limites;
    $('#crit-desc').textContent = it.criterio.tipo === 'nenhum' ? 'Sem exclusão automática: desconsidere manualmente o que não for compatível, sempre com justificativa.'
      : lim?.aplicavel ? `Faixa admitida: ${moeda(Math.max(0, lim.min))} a ${moeda(lim.max)} (${lim.rotulo}). O que ficar fora é desconsiderado automaticamente — e pode ser reconsiderado.` : (lim?.nota || '');
    $('#escolhido').innerHTML = it.codigo
      ? `<span class="selo selo--musgo">selecionado</span><strong class="mono">${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)}</strong><span class="secundario">${esc(it.tipo === 'servico' ? 'serviço' : 'material')}</span>`
      : '<span class="selo selo--ambar">nenhum código escolhido</span>';
    // item novo: a coleta vem antes das amostras
    const blocos = $('#blocos');
    const primeiro = it.amostras.length ? $('#sec-amostras') : $('#sec-coleta');
    if (blocos.firstElementChild !== primeiro) blocos.prepend(primeiro);
    atualizarBotaoBuscar();
    if ($('#det-trilha').open) carregarTrilha();
  };
  // O PNCP busca por texto: dispensa o código do catálogo.
  const atualizarBotaoBuscar = () => { const semCodigo = !it.codigo && $('#p-fonte').value !== 'pncp'; $('#btn-buscar').disabled = semCodigo; $('#btn-atualizar').disabled = semCodigo; };
  $('#p-fonte').addEventListener('change', atualizarBotaoBuscar);
  const salvarItem = async (corpo) => { it = await api(`/itens/${id}`, { method: 'PUT', body: corpo }); desenhar(); };
  desenhar();

  // --- critério do preço recomendado
  $('#veredito').addEventListener('change', async (ev) => {
    try {
      if (ev.target.name === 'metodo') { await salvarItem({ metodo: ev.target.value }); $(`#tiles-metodo input[value="${it.metodo}"]`)?.focus(); avisar(`Preço recomendado pela ${NOME_METODO[it.metodo] === 'menor preço' ? 'regra do menor preço' : NOME_METODO[it.metodo]}.`); }
      if (ev.target.id === 'metodo-auto') { await salvarItem({ metodo: ev.target.checked ? 'auto' : (it.estimativa.metodoAplicado || 'mediana') }); $('#metodo-auto')?.focus(); }
    } catch (e) { avisar(e.message, true); desenhar(); }
  });

  // --- critério de exclusão
  const lerCriterio = () => {
    const f = dadosForm($('#form-criterio'));
    const c = { tipo: f.criterio };
    if (['desvio', 'iqr'].includes(c.tipo)) c.k = Number(f.k);
    if (c.tipo === 'mediana') { c.inferior = Number(f.inferior) / 100; c.superior = Number(f.superior) / 100; }
    return c;
  };
  $('#form-criterio').addEventListener('submit', (ev) => ev.preventDefault());
  $('#form-criterio').addEventListener('change', async (ev) => {
    if (ev.target.name === 'criterio') $('#crit-params').innerHTML = htmlParametros({ tipo: ev.target.value });
    const antes = it.estimativa.resumo.n;
    try {
      await salvarItem({ criterio: lerCriterio() });
      const dif = antes - it.estimativa.resumo.n;
      avisar(it.criterio.tipo === 'nenhum' ? 'Exclusão automática desligada.' : `${NOME_CRITERIO[it.criterio.tipo]}: ${plural(it.amostras.length - it.estimativa.resumo.n, 'amostra excluída', 'amostras excluídas')}${dif ? ` (${dif > 0 ? '+' : '−'}${Math.abs(dif)})` : ''}.`);
    } catch (e) { avisar(e.message, true); }
  });

  // --- catálogo
  let buscaTimer;
  const buscarCatalogo = async () => {
    const q = $('#b-q').value.trim();
    const lista = $('#b-res');
    if (q.length < 2) { lista.innerHTML = ''; return; }
    try {
      const res = await api(`/catalogo/buscar?q=${encodeURIComponent(q)}`);
      lista.innerHTML = res.length ? res.map((r) => `<li><button type="button" data-tipo="${esc(r.tipo)}" data-codigo="${esc(r.codigo)}" data-nome="${esc(r.nome)}">
        <span class="selo selo--liso">${r.tipo === 'servico' ? 'serviço' : 'material'} ${esc(r.codigo)}</span> <strong>${esc(r.nome)}</strong>
        <small>${esc([r.classe, r.grupo].filter(Boolean).join(' · '))}</small></button></li>`).join('')
        : '<li class="vazio">Nada encontrado no catálogo local. Tente o nome genérico (ex.: “papel” em vez de “sulfite”).</li>';
    } catch (e) { lista.innerHTML = `<li class="nota nota--cobre">${esc(e.message)}</li>`; }
  };
  $('#b-q').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(buscarCatalogo, 250); });
  buscarCatalogo();
  $('#b-res').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-codigo]');
    if (!b) return;
    const tipo = b.dataset.tipo === 'servico' ? 'servico' : 'material';
    try { await salvarItem({ tipo, codigoTipo: b.dataset.tipo, codigo: Number(b.dataset.codigo) }); avisar(`Selecionado: ${b.dataset.nome}`); $('#p-pal').focus(); } catch (e) { avisar(e.message, true); }
  });
  $('#form-cod').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, () => salvarItem({ tipo: 'material', codigoTipo: 'item', codigo: Number(dadosForm(ev.target).codigo) }));
  });

  // --- preços
  const atualizarBotaoSelecao = () => {
    const n = $$('#res-precos .sel:checked').length;
    const b = $('#btn-add-sel');
    if (b) { b.disabled = !n; b.textContent = n ? `Adicionar ${plural(n, 'selecionada', 'selecionadas')}` : 'Adicionar selecionadas'; }
  };
  // Delegação registrada uma única vez (a tabela é redesenhada a cada busca)
  $('#res-precos').addEventListener('change', (ev) => {
    if (ev.target.id === 'sel-todas') $$('#res-precos .sel').forEach((c) => { c.checked = ev.target.checked; });
    atualizarBotaoSelecao();
  });
  $('#res-precos').addEventListener('click', async (ev) => {
    const b = ev.target.closest('#btn-add-sel');
    if (!b) return;
    const escolhidas = $$('#res-precos .sel:checked').map((c) => estado.resultados[Number(c.dataset.i)]);
    if (!escolhidas.length) return;
    await executar(b, async () => {
      const r = await api(`/itens/${id}/amostras`, { method: 'POST', body: { amostras: escolhidas } });
      it = r.item;
      desenhar();
      desenharResultados();
      avisar(`${plural(r.inseridas, 'amostra adicionada', 'amostras adicionadas')}${r.ignoradas ? `, ${r.ignoradas} já existiam` : ''}.`);
    });
  });

  $('#form-precos').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    const atualizar = ev.submitter?.id === 'btn-atualizar';
    salvarPreferencias({ uf: f.uf, fonte: f.fonte });
    const alvo = $('#res-precos');
    await executar(ev.submitter, async () => {
      const onde = { ambas: 'Compras.gov.br e PNCP', compras: 'Compras.gov.br', pncp: 'PNCP' }[f.fonte];
      alvo.innerHTML = `<p class="ajuda" role="status">${LOADER} Consultando ${onde}… Se a fonte demorar, o sistema tenta de novo sozinho (até 4 vezes) antes de recorrer ao cache local.</p>`;
      const qs = new URLSearchParams({ tipo: it.tipo, codigoTipo: it.codigo_tipo || 'pdm', ...(it.codigo ? { codigo: it.codigo } : {}), ...f, ...(atualizar ? { atualizar: '1' } : {}) });
      try {
        const r = await api(`/precos?${qs}`);
        estado.resultados = r.registros;
        estado.consulta = r;
        desenharResultados();
      } catch (e) {
        alvo.innerHTML = `<div class="nota nota--cobre" role="alert"><strong>Não foi possível consultar.</strong> ${esc(e.message)}<br>Não há resultado em cache para estes filtros. Verifique a conexão e tente novamente.</div>`;
      }
    });
  });

  function desenharResultados() {
    const r = estado.consulta;
    if (!r) return;
    const jaTem = new Set(it.amostras.map((a) => a.chave_origem));
    const regs = estado.resultados;
    $('#res-precos').innerHTML = `
      <div class="secao__topo"><div><span class="overline">Resultado da consulta</span><h3>${plural(regs.length, 'preço encontrado', 'preços encontrados')}${r.totalNaFonte !== regs.length ? ` <span class="secundario pequeno">de ${r.totalNaFonte} na fonte</span>` : ''}</h3></div></div>
      <div class="origem-cache" id="origem-cache">${(r.fontes || []).map(seloCache).join('')}</div>
      ${(r.fontes || []).some((f) => f.cache?.obsoleto) ? '<div class="nota">A fonte oficial não respondeu após as novas tentativas. Os preços abaixo são da <strong>última consulta guardada</strong> neste computador; confira a data antes de usar e tente “Atualizar da fonte” mais tarde.</div>' : ''}
      ${r.truncado ? '<div class="nota nota--neutra">Resultado limitado aos registros mais recentes; refine os filtros.</div>' : ''}
      ${(r.avisos || []).map((a) => `<div class="nota nota--neutra">${esc(a)}</div>`).join('')}
      ${regs.length ? `
      <div class="botoes secao__topo"><button type="button" class="btn btn--primario" id="btn-add-sel" disabled>Adicionar selecionadas</button>
        <label class="auto-linha"><input type="checkbox" id="sel-todas"> selecionar todas</label></div>
      <div class="tabela-wrap"><table class="tabela--fichas">
        <thead><tr><th class="col-sel"><span class="oculto-visual">Selecionar</span></th><th class="num">Preço unit.</th><th>Data</th><th>Fonte</th><th>Órgão / local</th><th>Descrição</th><th>Unid.</th><th class="num">Qtd.</th></tr></thead>
        <tbody>${regs.map((x, i) => `<tr>
          <td class="col-sel">${jaTem.has(x.chaveOrigem) ? '<span class="selo selo--musgo selo--liso" title="Já incluída">✓</span>' : `<input type="checkbox" class="sel" data-i="${i}" aria-label="Selecionar preço de ${esc(moeda(x.precoUnitario))}, ${esc(x.orgao || '')}">`}</td>
          <td class="num" data-rotulo="Preço unitário"><strong>${moeda(x.precoUnitario)}</strong></td><td class="mono" data-rotulo="Data">${data(x.dataCompra)}</td>
          <td data-rotulo="Fonte"><span class="selo selo--liso">${x.origem === 'pncp' ? 'PNCP' : 'Compras.gov.br'}</span></td>
          <td class="desc">${esc(x.orgao)}<small>${esc([[x.municipio, x.uf].filter(Boolean).join('/'), x.esfera].filter(Boolean).join(' · '))}</small></td>
          <td class="desc sem-rotulo"><span class="pequeno">${esc((x.descricao || '').slice(0, 220))}</span><small>${esc([x.marca && `Marca: ${x.marca}`, x.fornecedorNome].filter(Boolean).join(' · '))}
            ${x.link ? ` <a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">ver compra ↗</a>` : ''}</small></td>
          <td data-rotulo="Unidade">${esc(x.unidade || '—')}</td><td class="num" data-rotulo="Quantidade">${num(x.quantidade, 0)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="vazio">Nenhum preço no período e nos filtros informados. Amplie o período, retire a UF ou as palavras-chave.</p>'}`;
  }

  // --- amostras
  async function carregarTrilha() {
    const alvo = $('#trilha');
    try {
      const lista = await api(`/itens/${id}/historico`);
      alvo.innerHTML = lista.length ? `<ol class="trilha">${lista.map((d) => `<li><time datetime="${esc(d.em)}">${esc(doBanco(d.em).toLocaleString('pt-BR'))}</time>
        <span><strong>${esc(NOME_ACAO[d.acao] || d.acao)}</strong> — amostra de <span class="mono">${moeda(d.preco_unitario)}</span>, por <span class="mono">${esc(d.usuario || 'local')}</span>${d.justificativa ? `<br><span class="secundario">Justificativa: ${esc(d.justificativa)}</span>` : ''}</span></li>`).join('')}</ol>`
        : '<p class="ajuda">Nenhuma decisão registrada ainda. Cada vez que uma amostra é desconsiderada, reconsiderada, justificada ou removida, fica anotado aqui quem fez, quando e por quê.</p>';
    } catch (e) { alvo.innerHTML = `<div class="nota nota--cobre">${esc(e.message)}</div>`; }
  }
  $('#det-trilha').addEventListener('toggle', (ev) => { if (ev.target.open) carregarTrilha(); });

  $('#lista-amostras').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-acao]');
    if (!b) return;
    const aid = Number(b.dataset.id);
    const acao = b.dataset.acao;
    const a = it.amostras.find((x) => x.id === aid);
    let corpo;
    if (acao === 'remover') {
      if (!(await dialogo({ titulo: 'Remover a amostra?', texto: `A amostra de <strong>${esc(moeda(a.preco_unitario))}</strong> sai da pesquisa (a remoção fica registrada na trilha). Para apenas tirá-la do cálculo, prefira “Desconsiderar”.`, confirmar: 'Remover amostra', perigo: true }))) return;
    } else if (acao === 'excluir' || acao === 'justificar') {
      const justificativa = await dialogo({
        titulo: acao === 'excluir' ? 'Desconsiderar esta amostra' : 'Justificativa da exclusão',
        texto: `Preço de <strong>${esc(moeda(a.preco_unitario))}</strong> — ${esc(a.orgao || NOME_ORIGEM[a.origem] || a.origem)}. A justificativa vai para o Anexo II do mapa e para a trilha de auditoria (art. 6º, § 3º). A decisão pode ser revertida.`,
        confirmar: acao === 'excluir' ? 'Desconsiderar' : 'Registrar',
        campo: { rotulo: 'Justificativa', valor: a.justificativa || '', exemplo: 'Ex.: especificação diverge do termo de referência (embalagem com 100 unidades).', minimo: 10 },
      });
      if (!justificativa) return;
      corpo = acao === 'excluir' ? { manual: false, justificativa } : { justificativa };
    } else if (acao === 'incluir') corpo = { manual: true };
    else if (acao === 'auto') corpo = { manual: null };
    await executar(b, async () => {
      it = acao === 'remover' ? await api(`/amostras/${aid}`, { method: 'DELETE' }) : await api(`/amostras/${aid}`, { method: 'PUT', body: corpo });
      desenhar();
      desenharResultados();
      avisar({ remover: 'Amostra removida.', excluir: 'Amostra desconsiderada; justificativa registrada.', justificar: 'Justificativa registrada.', incluir: 'Amostra reconsiderada.', auto: 'Amostra devolvida ao critério automático.' }[acao]);
    });
  });

  $('#form-manual').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!ev.target.reportValidity()) return;
    const f = dadosForm(ev.target);
    await executar(ev.submitter, async () => {
      const r = await api(`/itens/${id}/amostras`, { method: 'POST', body: { amostras: [{ ...f, orgao: `Fonte: ${f.origem.replaceAll('-', ' ')}` }] } });
      it = r.item;
      ev.target.reset();
      $('#m-data').value = iso(new Date());
      desenhar();
      avisar('Cotação adicionada.');
    });
  });

  // --- configuração
  $('#form-cfg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    await executar(ev.submitter, async () => {
      await salvarItem({ descricao: f.descricao, quantidade: f.quantidade, unidade: f.unidade, observacao: f.observacao });
      document.title = `${it.descricao.slice(0, 60)} — Banco de Preços LS`;
      avisar('Item salvo e recalculado.');
    });
  });
  $('#btn-excluir-item').addEventListener('click', async () => {
    if (!(await dialogo({ titulo: 'Excluir este item?', texto: `O item e ${plural(it.amostras.length, 'amostra', 'amostras')} serão apagados.`, confirmar: 'Excluir item', perigo: true }))) return;
    try { await api(`/itens/${id}`, { method: 'DELETE' }); avisar('Item excluído.'); location.hash = `#/pesquisa/${pesquisa.id}`; } catch (e) { avisar(e.message, true); }
  });
}

// ------------------------------------------------------------------ início

async function iniciar() {
  const s = await api('/sessao').catch(() => ({}));
  if (s.exigeLogin && !s.usuario) return telaLogin();
  if (s.usuario) mostrarSessao(s.usuario);
  atualizarStatusCatalogo();
  atualizarStatusBackup();
  rotear();
}

window.addEventListener('hashchange', () => { if ($('#form-login')) return; rotear(); });
iniciar();
