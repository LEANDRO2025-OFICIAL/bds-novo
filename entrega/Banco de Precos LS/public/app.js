// Banco de Preços LS — interface (SPA sem dependências). Todo dado externo passa por esc().

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => (v === null || v === undefined ? '—' : BRL.format(v));
const num = (v, casas = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const data = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const pct = (v) => (v === null || v === undefined ? '—' : `${num(v * 100, 1)}%`);
// Data LOCAL em AAAA-MM-DD (toISOString usaria UTC e viraria o dia à noite no Brasil)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const METODOS = { auto: 'Automático (média se CV ≤ 25%, senão mediana)', media: 'Média', mediana: 'Mediana', menor: 'Menor preço' };
const NOME_METODO = { media: 'média', mediana: 'mediana', menor: 'menor preço' };
const CRITERIOS = {
  nenhum: 'Nenhum (só exclusões manuais)',
  desvio: 'Média ± k desvios padrão',
  iqr: 'Intervalo interquartil (Tukey)',
  mediana: 'Percentual sobre a mediana',
};

const main = $('#conteudo');

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

// ------------------------------------------------------------------ login (só quando publicado com USUARIOS)

function telaLogin() {
  document.title = 'Entrar — Banco de Preços LS';
  $('#status-catalogo').textContent = '';
  $('#sessao').textContent = '';
  main.innerHTML = `
    <section class="cartao login" aria-labelledby="t-login">
      <h1 id="t-login">Entrar</h1>
      <form id="form-login" class="campos">
        <div class="campo campo--largo"><label for="l-usuario">Usuário</label><input id="l-usuario" name="usuario" required autocomplete="username" autocapitalize="none"></div>
        <div class="campo campo--largo"><label for="l-senha">Senha</label><input id="l-senha" name="senha" type="password" required autocomplete="current-password"></div>
        <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">Entrar</button></div>
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
  el.innerHTML = `<span>${esc(usuario)}</span><button type="button" class="btn btn--secundario btn--pequeno" id="btn-sair">Sair</button>`;
  $('#btn-sair').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    telaLogin();
  });
}

let avisoTimer;
function avisar(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.toggle('erro', erro);
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, erro ? 7000 : 3500);
}

function preferencias() {
  try { return JSON.parse(localStorage.getItem('pp:filtros') || '{}'); } catch { return {}; }
}
function salvarPreferencias(p) {
  try { localStorage.setItem('pp:filtros', JSON.stringify(p)); } catch { /* armazenamento indisponível */ }
}

async function executar(botao, fn) {
  const original = botao?.innerHTML;
  if (botao) { botao.disabled = true; botao.innerHTML = `<span class="carregando" aria-hidden="true"></span> ${esc(botao.textContent.trim())}`; }
  try { return await fn(); } catch (e) { avisar(e.message, true); return undefined; } finally {
    if (botao && botao.isConnected) { botao.disabled = false; botao.innerHTML = original; }
  }
}

function dadosForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// ------------------------------------------------------------------ catálogo (cabeçalho)

let pollCatalogo;
async function atualizarStatusCatalogo() {
  const el = $('#status-catalogo');
  try {
    const s = await api('/catalogo/status');
    clearTimeout(pollCatalogo);
    if (s.emAndamento) {
      el.innerHTML = `<span class="carregando" aria-hidden="true"></span> Indexando catálogo oficial (${esc(s.progresso || '…')})`;
      pollCatalogo = setTimeout(atualizarStatusCatalogo, 2000);
      return;
    }
    const quando = s.atualizadoEm ? new Date(s.atualizadoEm).toLocaleDateString('pt-BR') : 'nunca';
    el.innerHTML = `
      <span>Catálogo: ${num(s.materiais, 0)} materiais · ${num(s.servicos, 0)} serviços · atualizado em ${esc(quando)}</span>
      ${s.erro ? `<span class="selo selo--nao" title="${esc(s.erro)}">falha na última atualização</span>` : ''}
      <button type="button" class="btn btn--secundario btn--pequeno" id="btn-catalogo">Atualizar</button>`;
    $('#btn-catalogo').addEventListener('click', async () => {
      await api('/catalogo/atualizar', { method: 'POST' }).catch((e) => avisar(e.message, true));
      atualizarStatusCatalogo();
    });
  } catch (e) {
    el.textContent = 'Servidor indisponível.';
  }
}

// ------------------------------------------------------------------ roteamento

const rotas = [
  [/^#?\/?$/, () => telaInicio()],
  [/^#\/pesquisa\/(\d+)$/, (m) => telaPesquisa(Number(m[1]))],
  [/^#\/pesquisa\/(\d+)\/mapa$/, (m) => telaMapa(Number(m[1]))],
  [/^#\/item\/(\d+)$/, (m) => telaItem(Number(m[1]))],
];

async function rotear() {
  const hash = location.hash || '#/';
  for (const [re, fn] of rotas) {
    const m = hash.match(re);
    if (m) {
      main.innerHTML = '<p class="vazio"><span class="carregando" aria-hidden="true"></span> Carregando…</p>';
      try { await fn(m); } catch (e) { main.innerHTML = `<div class="alerta alerta--erro">${esc(e.message)}</div><p><a href="#/">Voltar ao início</a></p>`; }
      main.focus({ preventScroll: true });
      return;
    }
  }
  main.innerHTML = '<p class="vazio">Página não encontrada. <a href="#/">Ir para o início</a></p>';
}

// ------------------------------------------------------------------ tela: início

async function telaInicio() {
  document.title = 'Banco de Preços LS';
  const lista = await api('/pesquisas');
  main.innerHTML = `
    <div class="cabecalho"><div><h1>Pesquisas de preços</h1>
      <p class="ajuda">Preços praticados em contratações públicas (Compras.gov.br), com análise conforme a IN SEGES/ME 65/2021.</p></div></div>
    <div class="grade grade-2">
      <section class="cartao" aria-labelledby="t-nova">
        <h2 id="t-nova">Nova pesquisa</h2>
        <form id="form-nova" class="campos">
          <div class="campo campo--largo"><label for="n-titulo">Objeto / título *</label><input id="n-titulo" name="titulo" required maxlength="300" placeholder="Ex.: Aquisição de material de expediente"></div>
          <div class="campo"><label for="n-processo">Nº do processo</label><input id="n-processo" name="processo" maxlength="100"></div>
          <div class="campo"><label for="n-orgao">Órgão</label><input id="n-orgao" name="orgao" maxlength="300" placeholder="Ex.: Prefeitura Municipal de …"></div>
          <div class="campo campo--largo"><label for="n-resp">Responsável</label><input id="n-resp" name="responsavel" maxlength="200"></div>
          <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">Criar pesquisa</button></div>
        </form>
      </section>
      <section class="cartao" aria-labelledby="t-lista">
        <h2 id="t-lista">Pesquisas salvas</h2>
        ${lista.length ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Objeto</th><th>Processo</th><th class="num">Itens</th><th>Atualizada</th></tr></thead>
          <tbody>${lista.map((p) => `<tr>
            <td><a href="#/pesquisa/${p.id}">${esc(p.titulo)}</a></td><td>${esc(p.processo || '—')}</td>
            <td class="num">${p.total_itens}</td><td>${esc(new Date(p.atualizado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR'))}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="vazio">Nenhuma pesquisa ainda. Crie a primeira ao lado.</p>'}
      </section>
    </div>`;
  $('#form-nova').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, async () => {
      const p = await api('/pesquisas', { method: 'POST', body: dadosForm(ev.target) });
      location.hash = `#/pesquisa/${p.id}`;
    });
  });
}

// ------------------------------------------------------------------ tela: pesquisa

async function telaPesquisa(id) {
  const p = await api(`/pesquisas/${id}`);
  document.title = `${p.titulo} — Banco de Preços LS`;
  main.innerHTML = `
    <nav class="migalha" aria-label="Navegação"><a href="#/">Pesquisas</a> › ${esc(p.titulo)}</nav>
    <div class="cabecalho">
      <div><h1>${esc(p.titulo)}</h1>
        <p class="ajuda">Processo ${esc(p.processo || '—')} · ${esc(p.orgao || 'órgão não informado')} · responsável: ${esc(p.responsavel || '—')}</p></div>
      <div class="botoes">
        <a class="btn btn--primario" href="#/pesquisa/${p.id}/mapa">Mapa de preços</a>
        <a class="btn btn--secundario" href="/api/pesquisas/${p.id}/csv" download>Exportar CSV</a>
      </div>
    </div>
    <section class="cartao" aria-labelledby="t-itens">
      <h2 id="t-itens">Itens</h2>
      ${p.itens.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th>#</th><th>Descrição</th><th>Código</th><th class="num">Qtd.</th><th>Unid.</th><th class="num">Amostras válidas</th><th>Método</th><th class="num">Unitário estimado</th><th class="num">Total</th></tr></thead>
        <tbody>${p.itens.map((it, i) => `<tr>
          <td>${i + 1}</td>
          <td class="desc"><a href="#/item/${it.id}">${esc(it.descricao)}</a>
            ${it.estimativa.alertas.length ? `<small>⚠ ${esc(it.estimativa.alertas[0])}</small>` : ''}</td>
          <td>${it.codigo ? `<span class="selo selo--info">${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)}</span>` : '<span class="selo">sem código</span>'}</td>
          <td class="num">${num(it.quantidade)}</td><td>${esc(it.unidade || '—')}</td>
          <td class="num">${it.estimativa.resumo.n} / ${it.amostras.length}</td>
          <td>${esc(NOME_METODO[it.estimativa.metodoAplicado] || '—')}</td>
          <td class="num">${moeda(it.estimativa.valor)}</td><td class="num">${moeda(it.total)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><th colspan="8" class="num">Valor total estimado</th><th class="num">${moeda(p.totalGeral)}</th></tr></tfoot>
        </table></div>` : '<p class="vazio">Nenhum item. Adicione o primeiro abaixo.</p>'}
    </section>
    <div class="grade grade-2">
      <section class="cartao" aria-labelledby="t-add">
        <h2 id="t-add">Adicionar item</h2>
        <form id="form-item" class="campos">
          <div class="campo campo--largo"><label for="i-desc">Descrição *</label><textarea id="i-desc" name="descricao" required maxlength="2000" placeholder="Ex.: Cadeira de escritório giratória com braços"></textarea></div>
          <div class="campo"><label for="i-tipo">Tipo</label><select id="i-tipo" name="tipo"><option value="material">Material</option><option value="servico">Serviço</option></select></div>
          <div class="campo"><label for="i-qtd">Quantidade *</label><input id="i-qtd" name="quantidade" type="number" min="0.0001" step="any" value="1" required></div>
          <div class="campo"><label for="i-un">Unidade</label><input id="i-un" name="unidade" maxlength="60" placeholder="UN, CX, KG…"></div>
          <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">Adicionar e pesquisar preços</button></div>
        </form>
      </section>
      <section class="cartao" aria-labelledby="t-dados">
        <h2 id="t-dados">Dados da pesquisa</h2>
        <form id="form-pesq" class="campos">
          <div class="campo campo--largo"><label for="p-titulo">Objeto *</label><input id="p-titulo" name="titulo" required maxlength="300" value="${esc(p.titulo)}"></div>
          <div class="campo"><label for="p-proc">Nº do processo</label><input id="p-proc" name="processo" maxlength="100" value="${esc(p.processo || '')}"></div>
          <div class="campo"><label for="p-org">Órgão</label><input id="p-org" name="orgao" maxlength="300" value="${esc(p.orgao || '')}"></div>
          <div class="campo campo--largo"><label for="p-resp">Responsável</label><input id="p-resp" name="responsavel" maxlength="200" value="${esc(p.responsavel || '')}"></div>
          <div class="botoes campo--largo">
            <button class="btn btn--secundario" type="submit">Salvar dados</button>
            <button class="btn btn--perigo" type="button" id="btn-excluir-pesq">Excluir pesquisa</button>
          </div>
        </form>
      </section>
    </div>`;

  $('#form-item').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, async () => {
      const it = await api(`/pesquisas/${id}/itens`, { method: 'POST', body: dadosForm(ev.target) });
      location.hash = `#/item/${it.id}`;
    });
  });
  $('#form-pesq').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, async () => {
      await api(`/pesquisas/${id}`, { method: 'PUT', body: dadosForm(ev.target) });
      avisar('Dados salvos.');
      telaPesquisa(id);
    });
  });
  $('#btn-excluir-pesq').addEventListener('click', async () => {
    if (!confirm(`Excluir a pesquisa "${p.titulo}" e todos os seus itens? Esta ação não pode ser desfeita.`)) return;
    await api(`/pesquisas/${id}`, { method: 'DELETE' }).catch((e) => avisar(e.message, true));
    location.hash = '#/';
  });
}

// ------------------------------------------------------------------ tela: item

function htmlEstatistica(it) {
  const e = it.estimativa;
  const r = e.resumo;
  return `
    <h2 id="t-analise">Análise</h2>
    ${e.alertas.map((a) => `<div class="alerta alerta--aviso">${esc(a)}</div>`).join('')}
    <p class="rotulo">Preço unitário estimado ${e.metodoAplicado ? `(${esc(NOME_METODO[e.metodoAplicado])})` : ''}</p>
    <p class="destaque">${moeda(e.valor)}</p>
    <p>Total (${num(it.quantidade)} ${esc(it.unidade || 'un.')}): <strong>${moeda(it.total)}</strong></p>
    <dl class="estat">
      <div><dt>Válidas</dt><dd>${r.n} de ${it.amostras.length}</dd></div>
      <div><dt>Média</dt><dd>${moeda(r.media)}</dd></div>
      <div><dt>Mediana</dt><dd>${moeda(r.mediana)}</dd></div>
      <div><dt>Menor</dt><dd>${moeda(r.menor)}</dd></div>
      <div><dt>Maior</dt><dd>${moeda(r.maior)}</dd></div>
      <div><dt>Desvio padrão</dt><dd>${moeda(r.desvioPadrao)}</dd></div>
      <div><dt>Coef. variação</dt><dd>${pct(r.cv)}</dd></div>
    </dl>`;
}

function htmlAmostras(it) {
  if (!it.amostras.length) return '<p class="vazio">Nenhuma amostra ainda. Busque preços ao lado e adicione as compatíveis com o item.</p>';
  return `<div class="tabela-wrap"><table>
    <thead><tr><th class="num">Preço unit.</th><th>Situação</th><th>Data</th><th>Órgão / local</th><th>Fornecedor</th><th>Descrição</th><th>Ações</th></tr></thead>
    <tbody>${it.amostras.map((a) => `<tr class="${a.incluida ? '' : 'excluida'}">
      <td class="num preco">${moeda(a.preco_unitario)}</td>
      <td>${a.incluida ? '<span class="selo selo--ok">considerada</span>' : '<span class="selo selo--nao">desconsiderada</span>'}
        ${a.motivo ? `<small class="ajuda"><br>${esc(a.motivo)}</small>` : ''}
        ${a.justificativa ? `<small class="ajuda"><br>Justificativa: ${esc(a.justificativa)}</small>` : ''}</td>
      <td>${data(a.data_compra)}</td>
      <td class="desc">${esc(a.orgao || a.origem)}<small>${esc([a.municipio, a.uf].filter(Boolean).join('/'))}</small></td>
      <td class="desc">${esc(a.fornecedor_nome || '—')}<small>${esc(a.marca ? `Marca: ${a.marca}` : '')}</small></td>
      <td class="desc"><small>${esc((a.descricao || '').slice(0, 160))}</small>${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">ver fonte ↗</a>` : ''}</td>
      <td><div class="botoes">
        ${a.incluida
          ? `<button type="button" class="btn btn--secundario btn--pequeno" data-acao="excluir" data-id="${a.id}">Desconsiderar</button>`
          : `<button type="button" class="btn btn--secundario btn--pequeno" data-acao="incluir" data-id="${a.id}">Considerar</button>`}
        ${a.manual !== null ? `<button type="button" class="btn btn--secundario btn--pequeno" data-acao="auto" data-id="${a.id}">Usar critério</button>` : ''}
        <button type="button" class="btn btn--perigo btn--pequeno" data-acao="remover" data-id="${a.id}" aria-label="Remover amostra de ${esc(moeda(a.preco_unitario))}">Remover</button>
      </div></td></tr>`).join('')}
    </tbody></table></div>`;
}

function htmlCriterioParams(c) {
  return `
    <div class="campo" ${['desvio', 'iqr'].includes(c.tipo) ? '' : 'hidden'}><label for="c-k">k</label><input id="c-k" name="k" type="number" min="0" max="10" step="0.1" value="${esc(c.k ?? (c.tipo === 'iqr' ? 1.5 : 1))}"></div>
    <div class="campo" ${c.tipo === 'mediana' ? '' : 'hidden'}><label for="c-inf">Abaixo da mediana (%)</label><input id="c-inf" name="inferior" type="number" min="0" max="100" step="1" value="${esc(Math.round((c.inferior ?? 0.5) * 100))}"></div>
    <div class="campo" ${c.tipo === 'mediana' ? '' : 'hidden'}><label for="c-sup">Acima da mediana (%)</label><input id="c-sup" name="superior" type="number" min="0" max="1000" step="1" value="${esc(Math.round((c.superior ?? 0.5) * 100))}"></div>`;
}

async function telaItem(id) {
  let it = await api(`/itens/${id}`);
  const pesquisa = await api(`/pesquisas/${it.pesquisa_id}`);
  document.title = `${it.descricao.slice(0, 60)} — Banco de Preços LS`;
  const pref = preferencias();
  const hoje = new Date();
  const umAno = new Date(hoje); umAno.setFullYear(hoje.getFullYear() - 1);
  const estado = { resultados: [], consulta: null };

  main.innerHTML = `
    <nav class="migalha" aria-label="Navegação"><a href="#/">Pesquisas</a> › <a href="#/pesquisa/${pesquisa.id}">${esc(pesquisa.titulo)}</a> › Item</nav>
    <div class="cabecalho"><h1>${esc(it.descricao)}</h1>
      <div class="botoes"><a class="btn btn--secundario" href="#/pesquisa/${pesquisa.id}">Voltar à pesquisa</a></div></div>
    <div class="grade grade-item">
      <div>
        <section class="cartao" id="painel-analise" aria-labelledby="t-analise"></section>
        <section class="cartao" aria-labelledby="t-config">
          <h2 id="t-config">Item e método</h2>
          <form id="form-cfg" class="campos">
            <div class="campo campo--largo"><label for="f-desc">Descrição</label><textarea id="f-desc" name="descricao" maxlength="2000" required>${esc(it.descricao)}</textarea></div>
            <div class="campo"><label for="f-qtd">Quantidade</label><input id="f-qtd" name="quantidade" type="number" min="0.0001" step="any" value="${esc(it.quantidade)}" required></div>
            <div class="campo"><label for="f-un">Unidade</label><input id="f-un" name="unidade" maxlength="60" value="${esc(it.unidade || '')}"></div>
            <div class="campo campo--largo"><label for="f-met">Método (art. 6º)</label><select id="f-met" name="metodo">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}" ${it.metodo === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
            <div class="campo campo--largo"><label for="f-crit">Excluir automaticamente valores fora de</label><select id="f-crit" name="criterio">${Object.entries(CRITERIOS).map(([k, v]) => `<option value="${k}" ${it.criterio.tipo === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
            <div id="crit-params" class="campos campo--largo">${htmlCriterioParams(it.criterio)}</div>
            <div class="campo campo--largo"><label for="f-obs">Observações / justificativas gerais</label><textarea id="f-obs" name="observacao" maxlength="4000">${esc(it.observacao || '')}</textarea></div>
            <div class="botoes campo--largo"><button class="btn btn--primario" type="submit">Salvar e recalcular</button>
              <button class="btn btn--perigo" type="button" id="btn-excluir-item">Excluir item</button></div>
          </form>
        </section>
      </div>
      <div>
        <section class="cartao" aria-labelledby="t-busca">
          <h2 id="t-busca">1. Identificar no catálogo oficial</h2>
          <div class="campos">
            <div class="campo campo--largo"><label for="b-q">Buscar material ou serviço (nome genérico ou código)</label>
              <input id="b-q" type="search" autocomplete="off" placeholder="Ex.: cadeira escritório, gasolina, limpeza urbana" value="${esc(it.descricao.split(/[,;(]/)[0].slice(0, 60))}">
              <span class="ajuda">O catálogo usa nomes genéricos (PDM). Escolha o mais próximo e refine pelas palavras-chave na etapa 2.</span></div>
          </div>
          <ul id="b-res" class="resultados-catalogo" aria-label="Resultados do catálogo"></ul>
          <div id="escolhido"></div>
          <details><summary>Informar código CATMAT do item diretamente</summary>
            <form id="form-cod" class="campos"><div class="campo"><label for="cod-item">Código do item (CATMAT)</label><input id="cod-item" name="codigo" inputmode="numeric" pattern="\\d{3,9}" required></div>
            <div class="botoes campo"><button class="btn btn--secundario" type="submit">Usar este código</button></div></form>
          </details>
        </section>
        <section class="cartao" aria-labelledby="t-precos">
          <h2 id="t-precos">2. Buscar preços praticados</h2>
          <form id="form-precos" class="campos">
            <div class="campo"><label for="p-fonte">Fonte</label><select id="p-fonte" name="fonte">
              ${[['ambas', 'Compras.gov.br + PNCP'], ['compras', 'Compras.gov.br'], ['pncp', 'PNCP']].map(([v, n]) => `<option value="${v}" ${(pref.fonte || 'ambas') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div class="campo"><label for="p-uf">UF</label><select id="p-uf" name="uf"><option value="">Todas</option>${UFS.map((u) => `<option ${pref.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
            <div class="campo"><label for="p-ini">De</label><input id="p-ini" name="inicio" type="date" value="${esc(iso(umAno))}"></div>
            <div class="campo"><label for="p-fim">Até</label><input id="p-fim" name="fim" type="date" value="${esc(iso(hoje))}"></div>
            <div class="campo campo--largo"><label for="p-pal">Palavras-chave na descrição (refina o resultado; obrigatórias para o PNCP)</label><input id="p-pal" name="palavras" placeholder="Ex.: tinta impressora"></div>
            <div class="botoes campo--largo"><button class="btn btn--primario" type="submit" id="btn-buscar">Buscar preços</button>
              <span class="ajuda">Período padrão: 12 meses (IN 65/2021, art. 5º, II).</span></div>
          </form>
          <div id="res-precos"></div>
        </section>
        <section class="cartao" aria-labelledby="t-amostras">
          <h2 id="t-amostras">3. Amostras da pesquisa</h2>
          <div id="lista-amostras"></div>
          <details class="nao-imprimir"><summary>Adicionar cotação de outra fonte (fornecedor, site, outro portal)</summary>
            <form id="form-manual" class="campos">
              <div class="campo"><label for="m-preco">Preço unitário (R$) *</label><input id="m-preco" name="precoUnitario" type="number" min="0" step="0.0001" required></div>
              <div class="campo"><label for="m-data">Data *</label><input id="m-data" name="dataCompra" type="date" required value="${esc(iso(hoje))}"></div>
              <div class="campo"><label for="m-origem">Fonte *</label><select id="m-origem" name="origem"><option value="cotacao-fornecedor">Cotação com fornecedor (art. 5º, IV)</option><option value="midia-especializada">Mídia/tabela especializada (art. 5º, III)</option><option value="site-eletronico">Site eletrônico (art. 5º, III)</option><option value="contratacao-similar">Contratação similar (art. 5º, II)</option><option value="nota-fiscal">Nota fiscal eletrônica (art. 5º, V)</option></select></div>
              <div class="campo"><label for="m-forn">Fornecedor / fonte</label><input id="m-forn" name="fornecedorNome" maxlength="300"></div>
              <div class="campo"><label for="m-ni">CNPJ/CPF</label><input id="m-ni" name="fornecedorNi" maxlength="20"></div>
              <div class="campo"><label for="m-link">Link</label><input id="m-link" name="link" type="url" maxlength="500"></div>
              <div class="campo campo--largo"><label for="m-desc">Descrição do produto cotado</label><input id="m-desc" name="descricao" maxlength="4000"></div>
              <div class="botoes campo--largo"><button class="btn btn--secundario" type="submit">Adicionar cotação</button></div>
            </form>
          </details>
        </section>
      </div>
    </div>`;

  const desenhar = () => {
    $('#painel-analise').innerHTML = htmlEstatistica(it);
    $('#lista-amostras').innerHTML = htmlAmostras(it);
    $('#escolhido').innerHTML = it.codigo
      ? `<div class="escolhido">Selecionado: <strong>${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)}</strong> — ${esc(it.tipo === 'servico' ? 'serviço' : 'material')}</div>`
      : '<p class="ajuda">Nenhum código escolhido ainda.</p>';
    atualizarBotaoBuscar();
  };
  // O PNCP busca por texto: dispensa o código do catálogo.
  const atualizarBotaoBuscar = () => { $('#btn-buscar').disabled = !it.codigo && $('#p-fonte').value !== 'pncp'; };
  $('#p-fonte').addEventListener('change', atualizarBotaoBuscar);
  desenhar();

  // --- catálogo
  let buscaTimer;
  const buscarCatalogo = async () => {
    const q = $('#b-q').value.trim();
    const lista = $('#b-res');
    if (q.length < 2) { lista.innerHTML = ''; return; }
    try {
      const res = await api(`/catalogo/buscar?q=${encodeURIComponent(q)}`);
      lista.innerHTML = res.length ? res.map((r) => `<li><button type="button" data-tipo="${esc(r.tipo)}" data-codigo="${esc(r.codigo)}" data-nome="${esc(r.nome)}">
        <span class="selo ${r.tipo === 'servico' ? '' : 'selo--info'}">${r.tipo === 'servico' ? 'serviço' : 'material'} ${esc(r.codigo)}</span> <strong>${esc(r.nome)}</strong>
        <small>${esc([r.classe, r.grupo].filter(Boolean).join(' · '))}</small></button></li>`).join('')
        : '<li class="vazio">Nada encontrado. Tente o nome genérico (ex.: “papel” em vez de “sulfite”).</li>';
    } catch (e) { lista.innerHTML = `<li class="alerta alerta--erro">${esc(e.message)}</li>`; }
  };
  $('#b-q').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(buscarCatalogo, 250); });
  buscarCatalogo();
  $('#b-res').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-codigo]');
    if (!b) return;
    const tipo = b.dataset.tipo === 'servico' ? 'servico' : 'material';
    it = await api(`/itens/${id}`, { method: 'PUT', body: { tipo, codigoTipo: b.dataset.tipo, codigo: Number(b.dataset.codigo) } }).catch((e) => { avisar(e.message, true); return it; });
    desenhar();
    avisar(`Selecionado: ${b.dataset.nome}`);
    $('#p-pal').focus();
  });
  $('#form-cod').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await executar(ev.submitter, async () => {
      it = await api(`/itens/${id}`, { method: 'PUT', body: { tipo: 'material', codigoTipo: 'item', codigo: Number(dadosForm(ev.target).codigo) } });
      desenhar();
    });
  });

  // --- preços
  const atualizarBotaoSelecao = () => {
    const n = $$('#res-precos .sel:checked').length;
    const b = $('#btn-add-sel');
    if (b) { b.disabled = !n; b.textContent = n ? `Adicionar ${n} selecionada(s)` : 'Adicionar selecionadas'; }
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
      avisar(`${r.inseridas} amostra(s) adicionada(s)${r.ignoradas ? `, ${r.ignoradas} já existiam` : ''}.`);
    });
  });

  $('#form-precos').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    salvarPreferencias({ uf: f.uf, fonte: f.fonte });
    const alvo = $('#res-precos');
    await executar(ev.submitter, async () => {
      const onde = { ambas: 'Compras.gov.br e PNCP', compras: 'Compras.gov.br', pncp: 'PNCP' }[f.fonte];
      alvo.innerHTML = `<p class="ajuda"><span class="carregando" aria-hidden="true"></span> Consultando ${onde}… (o PNCP pode levar até 1 minuto na primeira consulta)</p>`;
      const qs = new URLSearchParams({ tipo: it.tipo, codigoTipo: it.codigo_tipo || 'pdm', ...(it.codigo ? { codigo: it.codigo } : {}), ...f });
      try {
        const r = await api(`/precos?${qs}`);
        estado.resultados = r.registros;
        estado.consulta = r;
        desenharResultados();
      } catch (e) {
        alvo.innerHTML = `<div class="alerta alerta--erro">${esc(e.message)}</div>`;
      }
    });
  });

  function desenharResultados() {
    const r = estado.consulta;
    if (!r) return;
    const jaTem = new Set(it.amostras.map((a) => a.chave_origem));
    const regs = estado.resultados;
    $('#res-precos').innerHTML = `
      <p class="ajuda">${regs.length} preço(s) encontrado(s)${r.totalNaFonte !== regs.length ? ` de ${r.totalNaFonte} na fonte` : ''} · consultado em ${esc(new Date(r.consultadoEm).toLocaleString('pt-BR'))}
        ${r.truncado ? ' · <strong>resultado limitado aos registros mais recentes; refine os filtros</strong>' : ''}</p>
      ${(r.avisos || []).map((a) => `<div class="alerta alerta--aviso">${esc(a)}</div>`).join('')}
      ${regs.length ? `
      <div class="botoes"><button type="button" class="btn btn--primario" id="btn-add-sel" disabled>Adicionar selecionadas</button>
        <label><input type="checkbox" id="sel-todas"> selecionar todas visíveis</label></div>
      <div class="tabela-wrap"><table>
        <thead><tr><th><span class="oculto-visual">Selecionar</span></th><th class="num">Preço unit.</th><th>Data</th><th>Fonte</th><th>Órgão / local</th><th>Descrição</th><th>Unid.</th><th class="num">Qtd.</th></tr></thead>
        <tbody>${regs.map((x, i) => `<tr>
          <td>${jaTem.has(x.chaveOrigem) ? '<span class="selo selo--ok">já incluída</span>' : `<input type="checkbox" class="sel" data-i="${i}" aria-label="Selecionar preço de ${esc(moeda(x.precoUnitario))}">`}</td>
          <td class="num">${moeda(x.precoUnitario)}</td><td>${data(x.dataCompra)}</td>
          <td><span class="selo ${x.origem === 'pncp' ? 'selo--info' : ''}">${x.origem === 'pncp' ? 'PNCP' : 'Compras.gov.br'}</span></td>
          <td class="desc">${esc(x.orgao)}<small>${esc([x.municipio, x.uf].filter(Boolean).join('/'))} · ${esc(x.esfera || '')}</small></td>
          <td class="desc">${esc((x.descricao || '').slice(0, 220))}<small>${esc([x.marca && `Marca: ${x.marca}`, x.fornecedorNome].filter(Boolean).join(' · '))}</small>
            ${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">ver compra ↗</a>` : ''}</td>
          <td>${esc(x.unidade || '—')}</td><td class="num">${num(x.quantidade, 0)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="vazio">Nenhum preço no período/filtros. Amplie o período, retire a UF ou as palavras-chave.</p>'}`;
  }

  // --- amostras
  $('#lista-amostras').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-acao]');
    if (!b) return;
    const aid = b.dataset.id;
    const acao = b.dataset.acao;
    let justificativa = null;
    if (acao === 'remover' && !confirm('Remover esta amostra da pesquisa?')) return;
    if (acao === 'excluir') {
      justificativa = prompt('Justificativa para desconsiderar este preço (obrigatória — art. 6º, § 3º):');
      if (!justificativa || !justificativa.trim()) return;
    }
    await executar(b, async () => {
      if (acao === 'remover') it = await api(`/amostras/${aid}`, { method: 'DELETE' });
      else if (acao === 'excluir') it = await api(`/amostras/${aid}`, { method: 'PUT', body: { manual: false, justificativa: justificativa.trim() } });
      else if (acao === 'incluir') it = await api(`/amostras/${aid}`, { method: 'PUT', body: { manual: true } });
      else if (acao === 'auto') it = await api(`/amostras/${aid}`, { method: 'PUT', body: { manual: null } });
      desenhar();
      desenharResultados();
    });
  });

  $('#form-manual').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    await executar(ev.submitter, async () => {
      const r = await api(`/itens/${id}/amostras`, { method: 'POST', body: { amostras: [{ ...f, orgao: `Fonte: ${f.origem.replaceAll('-', ' ')}` }] } });
      it = r.item;
      ev.target.reset();
      desenhar();
      avisar('Cotação adicionada.');
    });
  });

  // --- configuração
  $('#f-crit').addEventListener('change', (ev) => {
    $('#crit-params').innerHTML = htmlCriterioParams({ tipo: ev.target.value });
  });
  $('#form-cfg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = dadosForm(ev.target);
    const criterio = { tipo: f.criterio };
    if (['desvio', 'iqr'].includes(f.criterio)) criterio.k = Number(f.k);
    if (f.criterio === 'mediana') { criterio.inferior = Number(f.inferior) / 100; criterio.superior = Number(f.superior) / 100; }
    await executar(ev.submitter, async () => {
      it = await api(`/itens/${id}`, { method: 'PUT', body: { descricao: f.descricao, quantidade: f.quantidade, unidade: f.unidade, metodo: f.metodo, criterio, observacao: f.observacao } });
      desenhar();
      avisar('Item salvo e recalculado.');
    });
  });
  $('#btn-excluir-item').addEventListener('click', async () => {
    if (!confirm('Excluir este item e suas amostras?')) return;
    await api(`/itens/${id}`, { method: 'DELETE' }).catch((e) => avisar(e.message, true));
    location.hash = `#/pesquisa/${pesquisa.id}`;
  });
}

// ------------------------------------------------------------------ tela: mapa de preços

async function telaMapa(id) {
  const p = await api(`/pesquisas/${id}`);
  document.title = `Mapa de preços — ${p.titulo}`;
  const agora = new Date().toLocaleString('pt-BR');
  main.innerHTML = `
    <nav class="migalha nao-imprimir" aria-label="Navegação"><a href="#/">Pesquisas</a> › <a href="#/pesquisa/${p.id}">${esc(p.titulo)}</a> › Mapa</nav>
    <div class="botoes nao-imprimir"><button class="btn btn--primario" type="button" id="btn-imprimir">Imprimir / salvar PDF</button>
      <a class="btn btn--secundario" href="/api/pesquisas/${p.id}/csv" download>Exportar CSV</a></div>
    <article class="cartao mapa">
      <h1>Mapa de apuração de preços</h1>
      <div class="meta">
        <div><strong>Objeto:</strong> ${esc(p.titulo)}</div>
        <div><strong>Processo:</strong> ${esc(p.processo || '—')}</div>
        <div><strong>Órgão:</strong> ${esc(p.orgao || '—')}</div>
        <div><strong>Responsável:</strong> ${esc(p.responsavel || '—')}</div>
        <div><strong>Emitido em:</strong> ${esc(agora)}</div>
        <div><strong>Valor total estimado:</strong> ${moeda(p.totalGeral)}</div>
      </div>
      ${p.itens.map((it, i) => `
      <section class="item">
        <h2>Item ${i + 1} — ${esc(it.descricao)}</h2>
        <p class="ajuda">${it.codigo ? `Catálogo: ${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)} · ` : ''}Quantidade: ${num(it.quantidade)} ${esc(it.unidade || '')} ·
          Método: ${esc(NOME_METODO[it.estimativa.metodoAplicado] || '—')} · Critério de exclusão: ${esc(CRITERIOS[it.criterio.tipo] || '—')}</p>
        ${it.estimativa.alertas.map((a) => `<div class="alerta alerta--aviso">${esc(a)}</div>`).join('')}
        <div class="tabela-wrap"><table>
          <thead><tr><th>#</th><th>Fonte / órgão</th><th>UF</th><th>Data</th><th>Fornecedor</th><th>Marca</th><th class="num">Preço unit.</th><th>Situação</th></tr></thead>
          <tbody>${it.amostras.map((a, j) => `<tr class="${a.incluida ? '' : 'excluida'}">
            <td>${j + 1}</td><td>${esc(a.orgao || a.origem)}${a.link ? `<br><small>${esc(a.link)}</small>` : ''}</td><td>${esc(a.uf || '—')}</td><td>${data(a.data_compra)}</td>
            <td>${esc(a.fornecedor_nome || '—')}${a.fornecedor_ni ? `<br><small>${esc(a.fornecedor_ni)}</small>` : ''}</td><td>${esc(a.marca || '—')}</td>
            <td class="num preco">${moeda(a.preco_unitario)}</td>
            <td>${a.incluida ? 'Considerada' : `Desconsiderada — ${esc(a.justificativa || a.motivo || '')}`}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Sem amostras.</td></tr>'}
          </tbody>
          <tfoot>
            <tr><th colspan="6" class="num">Média · Mediana · Menor · CV</th><th colspan="2">${moeda(it.estimativa.resumo.media)} · ${moeda(it.estimativa.resumo.mediana)} · ${moeda(it.estimativa.resumo.menor)} · ${pct(it.estimativa.resumo.cv)}</th></tr>
            <tr><th colspan="6" class="num">Preço unitário estimado</th><th class="num">${moeda(it.estimativa.valor)}</th><th>Total: ${moeda(it.total)}</th></tr>
          </tfoot></table></div>
        ${it.observacao ? `<p><strong>Observações:</strong> ${esc(it.observacao)}</p>` : ''}
      </section>`).join('') || '<p class="vazio">Pesquisa sem itens.</p>'}
      <p class="fundamento">Fundamentação: Lei nº 14.133/2021, art. 23; IN SEGES/ME nº 65/2021, arts. 5º e 6º.
        Fonte dos preços públicos: API de Dados Abertos do Compras.gov.br (módulo Pesquisa de Preço), consultada na data de coleta de cada amostra.
        Valores desconsiderados com critério objetivo ou justificativa registrada (art. 6º, § 3º).</p>
      <div class="assinatura"><div>${esc(p.responsavel || 'Responsável pela pesquisa')}</div><div>Visto da autoridade competente</div></div>
    </article>`;
  $('#btn-imprimir').addEventListener('click', () => window.print());
}

// ------------------------------------------------------------------ início

async function iniciar() {
  const s = await api('/sessao').catch(() => ({}));
  if (s.exigeLogin && !s.usuario) return telaLogin();
  if (s.usuario) mostrarSessao(s.usuario);
  atualizarStatusCatalogo();
  rotear();
}

window.addEventListener('hashchange', () => { if ($('#form-login')) return; rotear(); });
iniciar();
