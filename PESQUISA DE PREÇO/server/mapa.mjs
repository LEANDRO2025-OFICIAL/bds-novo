// Mapa de apuração de preços: página HTML própria, feita para impressão / "Salvar como PDF" (A4, papel claro).
// Tudo é gerado no servidor, sem biblioteca: tabela-resumo, gráfico de barras em SVG por item, declaração e anexos.
// A página é servida com CSP estrita: nada de style="" embutido — o SVG usa só atributos de apresentação e classes.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v) => (v === null || v === undefined ? '—' : BRL.format(v));
const num = (v, casas = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const dec = (v, casas = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (v) => (v === null || v === undefined ? '—' : `${dec(v * 100, 1)}%`);
const dataBr = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

export const NOME_METODO = { media: 'média', mediana: 'mediana', menor: 'menor preço' };
const NOME_CRITERIO = {
  nenhum: 'sem critério automático (apenas exclusões justificadas)',
  desvio: (c) => `desvio padrão — fora de média ± ${num(c.k ?? 1)} DP (escore z)`,
  iqr: (c) => `amplitude interquartil — fora de Q1 − ${num(c.k ?? 1.5)}×IQR a Q3 + ${num(c.k ?? 1.5)}×IQR`,
  mediana: (c) => `percentual da mediana — abaixo de −${Math.round((c.inferior ?? 0.5) * 100)}% ou acima de +${Math.round((c.superior ?? 0.5) * 100)}%`,
};
export function descreverCriterio(c) {
  const d = NOME_CRITERIO[c?.tipo] ?? NOME_CRITERIO.nenhum;
  return typeof d === 'function' ? d(c) : d;
}
const NOME_ORIGEM = {
  'compras.gov.br': 'Compras.gov.br', pncp: 'PNCP', 'cotacao-fornecedor': 'Cotação com fornecedor', 'midia-especializada': 'Mídia/tabela especializada',
  'site-eletronico': 'Site eletrônico', 'contratacao-similar': 'Contratação similar', 'nota-fiscal': 'Nota fiscal eletrônica', manual: 'Lançamento manual',
};
const origem = (o) => NOME_ORIGEM[o] || o || '—';

/** Texto seguro para string CSS entre aspas (conteúdo das caixas de margem do @page). */
export function cssTexto(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[\\"<>&]/g, (c) => `\\${c.codePointAt(0).toString(16)} `);
}

/** Teto "redondo" para o eixo (1, 2, 2,5, 5 × 10ⁿ) e passo com 4 divisões. */
export function eixoRedondo(maximo) {
  if (!(maximo > 0)) return { teto: 1, passo: 0.25 };
  const bruto = maximo / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto - pot * 1e-9);
  return { teto: passo * 4, passo };
}

/**
 * Gráfico de barras dos preços praticados de um item (SVG embutido, sem dependências).
 * Barras em ordem crescente, numeradas como no anexo; desconsideradas ficam vazadas e hachuradas;
 * linhas de referência: preço recomendado (cheia) e média/mediana (tracejadas).
 * Valor muito acima dos demais é cortado no topo (com o valor escrito) para não achatar o resto.
 */
export function graficoBarras(item, { largura = 560, altura = 158, id = `g${item.id ?? 0}` } = {}) {
  const amostras = item.amostras || [];
  const e = item.estimativa;
  const m = { esq: 62, dir: 118, topo: 16, base: 28 };
  const plotL = largura - m.esq - m.dir;
  const plotA = altura - m.topo - m.base;
  const titulo = `Preços praticados — ${amostras.length} amostra(s), ${e.resumo.n} considerada(s). Preço recomendado: ${moeda(e.valor)}${e.metodoAplicado ? ` (${NOME_METODO[e.metodoAplicado]})` : ''}.`;
  const abre = `<svg class="grafico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-labelledby="${id}-t"><title id="${id}-t">${esc(titulo)}</title>`;
  if (!amostras.length) {
    return `${abre}<rect x="0.5" y="0.5" width="${largura - 1}" height="${altura - 1}" fill="none" stroke="#cbd5e1" stroke-dasharray="4 3"/><text x="${largura / 2}" y="${altura / 2}" text-anchor="middle" class="g-vazio">Item sem amostras</text></svg>`;
  }

  const precos = amostras.map((a) => a.preco_unitario);
  const maxTodos = Math.max(...precos);
  const validas = amostras.filter((a) => a.incluida).map((a) => a.preco_unitario);
  const maxValidas = validas.length ? Math.max(...validas) : maxTodos;
  const cortar = maxValidas > 0 && maxTodos > maxValidas * 2.2;
  const { teto, passo } = eixoRedondo(cortar ? maxValidas * 1.45 : maxTodos * 1.08);
  const y = (v) => m.topo + plotA - (Math.min(v, teto) / teto) * plotA;
  const casasEixo = passo < 1 ? 2 : passo < 10 && !Number.isInteger(passo) ? 1 : 0;

  const p = [];
  p.push(`<defs><pattern id="${id}-h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#b45309" stroke-width="1.1"/></pattern></defs>`);
  // grade e eixo Y
  for (let v = 0; v <= teto + passo / 2; v += passo) {
    const yy = y(v).toFixed(1);
    p.push(`<line x1="${m.esq}" y1="${yy}" x2="${m.esq + plotL}" y2="${yy}" stroke="${v === 0 ? '#475569' : '#e2e8f0'}" stroke-width="${v === 0 ? 1 : 0.6}"/>`);
    p.push(`<text x="${m.esq - 6}" y="${(Number(yy) + 3).toFixed(1)}" text-anchor="end" class="g-eixo">${dec(v, casasEixo)}</text>`);
  }
  p.push(`<text x="${m.esq - 6}" y="${m.topo - 6}" text-anchor="end" class="g-unid">R$</text>`);

  // barras
  const n = amostras.length;
  const faixa = Math.min(plotL / n, 44);
  const larg = Math.max(1.2, Math.min(26, faixa * 0.68));
  const rotularValor = n <= 10;
  const passoRotulo = n <= 22 ? 1 : Math.ceil(n / 14);
  amostras.forEach((a, i) => {
    const cx = m.esq + faixa * (i + 0.5);
    const x = (cx - larg / 2).toFixed(1);
    const topo = y(a.preco_unitario);
    const h = Math.max(0.8, m.topo + plotA - topo).toFixed(1);
    const estourou = a.preco_unitario > teto;
    if (a.incluida) p.push(`<rect x="${x}" y="${topo.toFixed(1)}" width="${larg.toFixed(1)}" height="${h}" fill="#1e293b"/>`);
    else {
      p.push(`<rect x="${x}" y="${topo.toFixed(1)}" width="${larg.toFixed(1)}" height="${h}" fill="#ffffff"/>`);
      p.push(`<rect x="${x}" y="${topo.toFixed(1)}" width="${larg.toFixed(1)}" height="${h}" fill="url(#${id}-h)" stroke="#b45309" stroke-width="0.8"/>`);
    }
    if (estourou) {
      // marca de corte: a barra continua além do eixo
      const yc = m.topo + 7;
      p.push(`<path d="M${(cx - larg / 2 - 2).toFixed(1)} ${yc + 3} l${(larg / 2 + 2).toFixed(1)} -4 l${(larg / 2 + 2).toFixed(1)} 4" fill="none" stroke="#ffffff" stroke-width="3.2"/>`);
      p.push(`<path d="M${(cx - larg / 2 - 2).toFixed(1)} ${yc + 3} l${(larg / 2 + 2).toFixed(1)} -4 l${(larg / 2 + 2).toFixed(1)} 4" fill="none" stroke="#b45309" stroke-width="0.9"/>`);
      p.push(`<text x="${cx.toFixed(1)}" y="${m.topo - 5}" text-anchor="middle" class="g-valor g-fora">${dec(a.preco_unitario)}</text>`);
    } else if (rotularValor) {
      p.push(`<text x="${cx.toFixed(1)}" y="${(topo - 3.5).toFixed(1)}" text-anchor="middle" class="g-valor${a.incluida ? '' : ' g-fora'}">${dec(a.preco_unitario)}</text>`);
    }
    if (i % passoRotulo === 0 || i === n - 1) p.push(`<text x="${cx.toFixed(1)}" y="${m.topo + plotA + 11}" text-anchor="middle" class="g-eixo">${i + 1}</text>`);
  });
  p.push(`<text x="${m.esq + plotL / 2}" y="${altura - 4}" text-anchor="middle" class="g-unid">nº da amostra (ordem crescente de preço — ver Anexo)</text>`);

  // linhas de referência com rótulos à direita (sem sobreposição)
  const refs = [];
  if (e.valor !== null && e.valor !== undefined) refs.push({ v: e.valor, texto: `Recomendado ${dec(e.valor)}`, principal: true });
  if (e.resumo.n) {
    if (e.metodoAplicado !== 'media') refs.push({ v: e.resumo.media, texto: `Média ${dec(e.resumo.media)}` });
    if (e.metodoAplicado !== 'mediana') refs.push({ v: e.resumo.mediana, texto: `Mediana ${dec(e.resumo.mediana)}` });
  }
  refs.sort((a, b) => b.v - a.v);
  let anterior = -Infinity;
  for (const r of refs) {
    r.y = y(r.v);
    r.yRotulo = Math.max(r.y, anterior + 11);
    anterior = r.yRotulo;
  }
  const x2 = m.esq + plotL;
  for (const r of refs) {
    p.push(`<line x1="${m.esq}" y1="${r.y.toFixed(1)}" x2="${x2 + 4}" y2="${r.y.toFixed(1)}" stroke="${r.principal ? '#d97706' : '#475569'}" stroke-width="${r.principal ? 1.6 : 0.8}"${r.principal ? '' : ' stroke-dasharray="4 3"'}/>`);
    if (Math.abs(r.yRotulo - r.y) > 0.5) p.push(`<line x1="${x2 + 4}" y1="${r.y.toFixed(1)}" x2="${x2 + 8}" y2="${r.yRotulo.toFixed(1)}" stroke="#94a3b8" stroke-width="0.6"/>`);
    p.push(`<text x="${x2 + 10}" y="${(r.yRotulo + 3).toFixed(1)}" class="${r.principal ? 'g-rec' : 'g-ref'}">${esc(r.texto)}</text>`);
  }
  return `${abre}${p.join('')}</svg>`;
}

const MARCA_SVG = '<svg class="timbre__marca" viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="6" fill="#0a0e14"/><rect x="11" y="27" width="6" height="11" fill="#94a3b8"/><rect x="21" y="19" width="6" height="19" fill="#d97706"/><rect x="31" y="11" width="6" height="27" fill="#94a3b8"/><line x1="8" y1="19" x2="40" y2="19" stroke="#d97706" stroke-width="1.5" stroke-dasharray="3 2"/></svg>';

function tabelaAmostras(it, linhas, comMotivo) {
  if (!linhas.length) return `<p class="vazio">${comMotivo ? 'Nenhuma amostra desconsiderada neste item.' : 'Nenhuma amostra considerada neste item.'}</p>`;
  return `<table class="tabela tabela--anexo">
    <thead><tr><th class="num">Nº</th><th>Fonte / órgão</th><th>UF</th><th>Data</th><th>Fornecedor</th><th>Marca</th><th class="num">Preço unit.</th>${comMotivo ? '<th>Motivo da desconsideração</th>' : ''}</tr></thead>
    <tbody>${linhas.map(({ a, n }) => `<tr>
      <td class="num">${n}</td>
      <td><strong>${esc(origem(a.origem))}</strong>${a.orgao && !/^Fonte:/.test(a.orgao) ? ` — ${esc(a.orgao)}` : ''}${a.municipio ? `, ${esc(a.municipio)}` : ''}${a.link ? `<span class="fonte-link">${esc(a.link)}</span>` : ''}</td>
      <td class="curto">${esc(a.uf || '—')}</td><td class="mono curto">${dataBr(a.data_compra)}</td>
      <td>${esc(a.fornecedor_nome || '—')}${a.fornecedor_ni ? `<span class="fonte-link">${esc(a.fornecedor_ni)}</span>` : ''}</td>
      <td>${esc(a.marca || '—')}</td>
      <td class="num${comMotivo ? ' riscado' : ''}">${moeda(a.preco_unitario)}</td>
      ${comMotivo ? `<td>${esc(a.motivo || '—')}${a.justificativa ? `<span class="justificativa">Justificativa: ${esc(a.justificativa)}</span>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table>`;
}

/**
 * Página completa do mapa. `nonce` libera o único <style> embutido (textos das caixas de margem do @page).
 * emitidoEm: Date; fuso: nome IANA opcional (padrão: fuso do computador).
 */
export function renderizarMapa(p, { emitidoEm = new Date(), nonce = '', fuso = undefined, usuario = null } = {}) {
  const emitido = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: fuso || undefined }).format(emitidoEm);
  const responsavel = p.responsavel || 'não informado';
  const totalAmostras = p.itens.reduce((s, it) => s + it.amostras.length, 0);
  const totalValidas = p.itens.reduce((s, it) => s + it.estimativa.resumo.n, 0);
  const insuficientes = p.itens.filter((it) => it.estimativa.resumo.n < 3);
  const fontes = [...new Set(p.itens.flatMap((it) => it.amostras.map((a) => origem(a.origem))))];
  const numerar = (it) => it.amostras.map((a, i) => ({ a, n: i + 1 }));

  const paginaCss = `@page{@top-left{content:"Banco de Preços LS · Mapa de apuração de preços"}@top-right{content:"${cssTexto(p.processo ? `Processo ${p.processo}` : p.titulo.slice(0, 80))}"}@bottom-left{content:"Emitido em ${cssTexto(emitido)} · Responsável: ${cssTexto(responsavel.slice(0, 60))} · Lei nº 14.133/2021, art. 23 · IN SEGES/ME nº 65/2021"}@bottom-right{content:"Página " counter(page) " de " counter(pages)}}@page :first{@top-left{content:""}@top-right{content:""}}`;

  const linhasResumo = p.itens.map((it, i) => {
    const r = it.estimativa.resumo;
    const exc = it.amostras.length - r.n;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="descricao">${esc(it.descricao)}${it.codigo ? `<span class="codigo">${esc((it.codigo_tipo || '').toUpperCase())} ${esc(it.codigo)}</span>` : ''}${r.n < 3 ? '<span class="alerta-linha">menos de 3 preços válidos — justificar (art. 6º, § 5º)</span>' : ''}</td>
      <td class="curto">${esc(it.unidade || '—')}</td>
      <td class="num">${num(it.quantidade, 4)}</td>
      <td class="num">${r.n}${exc ? `<span class="exc"> / ${exc} exc.</span>` : ''}</td>
      <td class="num">${moeda(r.menor)}</td><td class="num">${moeda(r.maior)}</td>
      <td class="num">${moeda(r.media)}</td><td class="num">${moeda(r.mediana)}</td>
      <td class="num">${r.n ? dec(r.desvioPadrao) : '—'}</td><td class="num">${pct(r.cv)}</td>
      <td class="num rec"><strong>${moeda(it.estimativa.valor)}</strong><span class="criterio">${esc(NOME_METODO[it.estimativa.metodoAplicado] || '—')}</span></td>
      <td class="num">${moeda(it.total)}</td></tr>`;
  }).join('');

  const graficos = p.itens.map((it, i) => `<figure class="item-grafico">
      <figcaption><span class="item-n">Item ${i + 1}</span> ${esc(it.descricao.length > 110 ? `${it.descricao.slice(0, 108)}…` : it.descricao)}</figcaption>
      ${graficoBarras(it, { id: `g${i + 1}` })}
      <p class="item-nota">Critério de exclusão: ${esc(descreverCriterio(it.criterio))}.${it.limites?.aplicavel ? ` Faixa admitida: ${moeda(Math.max(0, it.limites.min))} a ${moeda(it.limites.max)}.` : ''}</p>
      ${it.estimativa.alertas.map((a) => `<p class="item-alerta">${esc(a)}</p>`).join('')}
      ${it.observacao ? `<p class="item-nota"><strong>Observações:</strong> ${esc(it.observacao)}</p>` : ''}
    </figure>`).join('');

  const anexo = (comMotivo) => p.itens.map((it, i) => {
    const linhas = numerar(it).filter(({ a }) => (comMotivo ? !a.incluida : a.incluida));
    return `<section class="anexo-item"><h3><span class="item-n">Item ${i + 1}</span> ${esc(it.descricao)}</h3>${tabelaAmostras(it, linhas, comMotivo)}</section>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Mapa de preços — ${esc(p.titulo)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/fontes.css">
<link rel="stylesheet" href="/mapa.css">
<style nonce="${esc(nonce)}">${paginaCss}</style>
<script type="module" src="/mapa.js"></script>
</head>
<body>
<div class="barra nao-imprimir" role="region" aria-label="Ações do mapa">
  <a class="barra__voltar" href="/#/pesquisa/${p.id}">← Voltar à pesquisa</a>
  <p class="barra__dica">Na janela de impressão escolha <strong>Salvar como PDF</strong>, papel <strong>A4</strong>, e desmarque “Cabeçalhos e rodapés” do navegador.</p>
  <a class="barra__botao barra__botao--sec" href="/api/pesquisas/${p.id}/csv" download>Exportar CSV</a>
  <button type="button" class="barra__botao" id="btn-imprimir">Imprimir / Salvar como PDF</button>
</div>
<main class="folha">
  <header class="timbre">
    ${MARCA_SVG}
    <div class="timbre__nome"><span class="timbre__sistema">Banco de Preços LS</span><span class="timbre__sub">Pesquisa de preços em contratações públicas</span></div>
    <div class="timbre__doc"><h1>Mapa de apuração de preços</h1><p>Lei nº 14.133/2021, art. 23 · IN SEGES/ME nº 65/2021</p></div>
  </header>

  <section class="identificacao" aria-label="Identificação">
    <div class="id-objeto"><span class="rotulo">Objeto</span><p>${esc(p.titulo)}</p></div>
    <dl>
      <div><dt>Processo</dt><dd>${esc(p.processo || '—')}</dd></div>
      <div><dt>Órgão</dt><dd>${esc(p.orgao || '—')}</dd></div>
      <div><dt>Responsável</dt><dd>${esc(responsavel)}</dd></div>
      <div><dt>Emissão</dt><dd class="mono">${esc(emitido)}</dd></div>
      <div><dt>Itens</dt><dd class="mono">${p.itens.length}</dd></div>
      <div><dt>Amostras válidas / coletadas</dt><dd class="mono">${totalValidas} / ${totalAmostras}</dd></div>
    </dl>
    <div class="id-total"><span class="rotulo">Valor total estimado</span><p>${moeda(p.totalGeral)}</p></div>
  </section>

  <section>
    <h2><span class="secao-n">1</span> Quadro-resumo dos preços</h2>
    ${p.itens.length ? `<p class="legenda-tabela legenda-tabela--antes">Valores em reais (R$). Estatísticas calculadas somente com as amostras válidas. Desvio padrão amostral (n − 1). CV = desvio padrão ÷ média.</p>
    <table class="tabela tabela--resumo">
      <thead><tr><th class="num">Item</th><th>Descrição</th><th>Unid.</th><th class="num">Qtd.</th><th class="num">Amostras válidas</th><th class="num">Menor</th><th class="num">Maior</th><th class="num">Média</th><th class="num">Mediana</th><th class="num">Desvio padrão</th><th class="num">CV</th><th class="num rec">Preço recomendado</th><th class="num">Total do item</th></tr></thead>
      <tbody>${linhasResumo}</tbody>
      <tfoot><tr><td colspan="12" class="num">Valor total estimado da contratação</td><td class="num total">${moeda(p.totalGeral)}</td></tr></tfoot>
    </table>` : '<p class="vazio">Pesquisa sem itens.</p>'}
  </section>

  ${p.itens.length ? `<section class="secao-graficos">
    <h2><span class="secao-n">2</span> Preços praticados por item</h2>
    <p class="legenda-grafico" aria-hidden="true">
      <span><svg viewBox="0 0 14 10" class="chave"><rect width="14" height="10" fill="#1e293b"/></svg> amostra considerada</span>
      <span><svg viewBox="0 0 14 10" class="chave"><defs><pattern id="lg-h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#b45309" stroke-width="1"/></pattern></defs><rect x="0.4" y="0.4" width="13.2" height="9.2" fill="url(#lg-h)" stroke="#b45309" stroke-width="0.8"/></svg> desconsiderada (motivo no Anexo II)</span>
      <span><svg viewBox="0 0 18 10" class="chave chave--linha"><line x1="0" y1="5" x2="18" y2="5" stroke="#d97706" stroke-width="2"/></svg> preço recomendado</span>
      <span><svg viewBox="0 0 18 10" class="chave chave--linha"><line x1="0" y1="5" x2="18" y2="5" stroke="#475569" stroke-width="1" stroke-dasharray="4 3"/></svg> média / mediana</span>
    </p>
    <div class="graficos">${graficos}</div>
  </section>` : ''}

  <section class="conformidade">
    <h2><span class="secao-n">3</span> Metodologia e declaração de conformidade</h2>
    <div class="conformidade__texto">
      <p>Os preços foram coletados nos parâmetros do art. 5º da IN SEGES/ME nº 65/2021${fontes.length ? ` (${esc(fontes.join('; '))})` : ''}, priorizados os sistemas oficiais de governo e as contratações similares da Administração Pública, e tratados conforme o art. 6º: o preço recomendado de cada item resulta da média, da mediana ou do menor dos valores válidos, conforme indicado no quadro-resumo.</p>
      <p>Valores inexequíveis, inconsistentes ou excessivamente elevados foram desconsiderados por critério objetivo ou por decisão fundamentada, com o motivo e a justificativa registrados individualmente no Anexo II (art. 6º, §§ 3º e 4º).${insuficientes.length ? ` <strong>Atenção:</strong> ${insuficientes.length === 1 ? 'o item' : 'os itens'} ${insuficientes.map((it) => p.itens.indexOf(it) + 1).join(', ')} ${insuficientes.length === 1 ? 'tem' : 'têm'} menos de três preços válidos e ${insuficientes.length === 1 ? 'exige' : 'exigem'} justificativa nos autos, aprovada pela autoridade competente (art. 6º, § 5º).` : ''}</p>
    </div>
    <div class="declaracao">
      <p><strong>Declaro</strong>, para os fins do art. 23 da Lei nº 14.133/2021, que a presente pesquisa de preços observou os procedimentos da Instrução Normativa SEGES/ME nº 65, de 7 de julho de 2021, e que os valores acima refletem os preços praticados no mercado na data de emissão deste mapa.</p>
      <div class="assinaturas">
        <div><span class="linha"></span><strong>${esc(p.responsavel || 'Responsável pela pesquisa')}</strong><span>Responsável pela pesquisa de preços</span></div>
        <div><span class="linha"></span><strong>Autoridade competente</strong><span>Visto / aprovação</span></div>
      </div>
      <p class="emissao">Emitido em ${esc(emitido)}${usuario ? ` por ${esc(usuario)}` : ''} · Banco de Preços LS</p>
    </div>
  </section>

  ${p.itens.length ? `<section class="anexo">
    <h2><span class="secao-n">Anexo I</span> Amostras consideradas</h2>
    <p class="legenda-tabela">Numeração por item, em ordem crescente de preço — a mesma dos gráficos da seção 2.</p>
    ${anexo(false)}
  </section>
  <section class="anexo">
    <h2><span class="secao-n">Anexo II</span> Amostras desconsideradas e motivos</h2>
    <p class="legenda-tabela">Cada exclusão é reversível no sistema e fica registrada na trilha de auditoria do item (art. 6º, § 3º).</p>
    ${anexo(true)}
  </section>` : ''}
</main>
</body>
</html>`;
}
