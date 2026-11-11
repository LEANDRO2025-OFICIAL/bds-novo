// Exportação CSV no padrão que o Excel em português abre com dois cliques:
// separador ';', UTF-8 com BOM, decimais com vírgula, linhas CRLF (RFC 4180 nos demais pontos).

export const BOM = '﻿';
const SEPARADOR = ';';
const FIM_DE_LINHA = '\r\n';

/** Número → texto com vírgula decimal. `casas` fixa as decimais (dinheiro); sem `casas` usa a menor forma exata. */
export function csvNumero(n, casas = null) {
  if (!Number.isFinite(n)) return '';
  const s = casas === null ? String(n) : n.toFixed(casas);
  // notação científica (1e-7, 1e21) não é número para o Excel: expande
  const plano = /e/i.test(s) ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : s;
  return plano.replace('.', ',');
}

/** Valor monetário com duas casas (use em colunas de preço). */
export const dinheiro = (n) => (n === null || n === undefined ? null : { numero: Number(n), casas: 2 });

/**
 * Uma célula. Números viram decimais com vírgula. Texto que o Excel/LibreOffice interpretaria como
 * fórmula (começa com = + - @, tab ou CR — CSV injection, OWASP) recebe um apóstrofo na frente.
 * Aspas são duplicadas e o campo vai entre aspas quando contém ; " ou quebra de linha.
 */
export function csvCampo(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = csvNumero(v);
  else if (typeof v === 'object' && 'numero' in v) s = csvNumero(v.numero, v.casas);
  else {
    s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Matriz de linhas → texto CSV completo (com BOM e CRLF, inclusive após a última linha). */
export function montarCsv(linhas) {
  return BOM + linhas.map((l) => l.map(csvCampo).join(SEPARADOR) + FIM_DE_LINHA).join('');
}

const NOME_METODO = { media: 'média', mediana: 'mediana', menor: 'menor preço' };

export const CABECALHO = [
  'Item', 'Descrição', 'Quantidade', 'Unidade', 'Registro', 'Data', 'Órgão', 'UF', 'Município', 'Fornecedor', 'CNPJ/CPF', 'Marca',
  'Preço unitário', 'Considerada', 'Motivo/Justificativa', 'Fonte',
  'Válidas', 'Excluídas', 'Média', 'Mediana', 'Menor', 'Maior', 'Desvio padrão', 'CV (%)', 'Preço recomendado', 'Critério', 'Total do item',
];

/** CSV da pesquisa: uma linha por amostra e uma linha "RESUMO" por item com as estatísticas e o preço recomendado. */
export function gerarCsv(p) {
  const linhas = [CABECALHO];
  const vazio = (n) => Array(n).fill('');
  p.itens.forEach((it, i) => {
    for (const a of it.amostras) {
      linhas.push([
        i + 1, it.descricao, it.quantidade, it.unidade || a.unidade, 'Amostra', a.data_compra, a.orgao, a.uf, a.municipio, a.fornecedor_nome, a.fornecedor_ni, a.marca,
        dinheiro(a.preco_unitario), a.incluida ? 'Sim' : 'Não', [a.motivo, a.justificativa].filter(Boolean).join(' — '), a.link || a.origem,
        ...vazio(11),
      ]);
    }
    const r = it.estimativa.resumo;
    linhas.push([
      i + 1, it.descricao, it.quantidade, it.unidade, 'RESUMO', ...vazio(11),
      r.n, it.amostras.length - r.n, dinheiro(r.media), dinheiro(r.mediana), dinheiro(r.menor), dinheiro(r.maior), dinheiro(r.desvioPadrao),
      r.cv === null || r.cv === undefined ? null : { numero: r.cv * 100, casas: 1 },
      dinheiro(it.estimativa.valor), NOME_METODO[it.estimativa.metodoAplicado] || '', dinheiro(it.total),
    ]);
  });
  linhas.push(['', 'VALOR TOTAL ESTIMADO', ...vazio(24), dinheiro(p.totalGeral)]);
  return montarCsv(linhas);
}
