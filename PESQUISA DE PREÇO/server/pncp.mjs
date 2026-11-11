// Cliente das APIs públicas do PNCP (Portal Nacional de Contratações Públicas — Lei 14.133/2021, art. 174).
// Contratos oficiais: https://pncp.gov.br/api/pncp/v3/api-docs (itens e resultados de contratação) e
// https://pncp.gov.br/api/consulta/v3/api-docs (consulta). A API de consulta não filtra pela descrição do item,
// por isso as contratações são localizadas pela busca pública do portal (https://pncp.gov.br/api/search/,
// a mesma de pncp.gov.br/app/editais), conferida ao vivo em 17/10/2026.
// Mesmo cliente HTTP do Compras.gov.br (cache 24 h, timeout por tentativa, backoff com jitter, reserva em cache), com fila própria.
import { obterJson, criarFila, criarRastro, montarUrl, filtrarPorPalavras, ErroApi } from './compras.mjs';

export const BASE = 'https://pncp.gov.br';
const FONTE = 'PNCP';
const enfileirar = criarFila(4); // cada contratação custa 1 + N chamadas (itens + resultados): até 4 simultâneas
export const BUSCA_PAGINA = 100;
export const BUSCA_PAGINAS_MAX = 5;
export const LIMITE_CONTRATACOES = 60; // contratações com resultado examinadas por consulta
const ITENS_PAGINA = 500; // aceito pela API (testado em 17/10/2026)

const dia = (s) => (s ? String(s).slice(0, 10) : null);
const ESFERA = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };

/** Página pública da contratação no PNCP. */
export function linkContratacao(cnpj, ano, sequencial) {
  return `${BASE}/app/editais/${cnpj}/${ano}/${sequencial}`;
}

/** Resultado utilizável como preço: não cancelado, em reais, com valor unitário positivo. */
function resultadoValido(r) {
  const cancelado = /cancel/i.test(r.situacaoCompraItemResultadoNome || '') || (r.dataCancelamento && !String(r.dataCancelamento).startsWith('0001'));
  const preco = Number(r.valorUnitarioHomologado);
  return !cancelado && !r.moedaEstrangeira && Number.isFinite(preco) && preco > 0;
}

/** Converte contratação (da busca) + item + resultado do PNCP para o formato interno de amostra. */
export function normalizarResultado(c, item, r) {
  return {
    origem: 'pncp',
    chaveOrigem: `pncp-${c.numero_controle_pncp}-${item.numeroItem}-${r.sequencialResultado}`,
    dataCompra: dia(r.dataResultado),
    orgao: [c.orgao_nome, c.unidade_nome].filter(Boolean).join(' — ') || null,
    uasg: c.unidade_codigo ?? null,
    uf: c.uf ?? null,
    municipio: c.municipio_nome ?? null,
    esfera: ESFERA[c.esfera_id] ?? c.esfera_nome ?? null,
    fornecedorNi: r.niFornecedor ?? null,
    fornecedorNome: r.nomeRazaoSocialFornecedor ?? null,
    marca: null, // o PNCP não publica marca no resultado do item
    descricao: item.descricao ?? null,
    unidade: item.unidadeMedida ?? null,
    quantidade: r.quantidadeHomologada ?? item.quantidade ?? null,
    precoUnitario: Number(r.valorUnitarioHomologado),
    objeto: c.description ? String(c.description).slice(0, 500) : null,
    modalidade: c.modalidade_licitacao_nome ?? null,
    forma: null,
    codigoItemCatalogo: item.catalogoCodigoItem ?? null,
    link: linkContratacao(c.orgao_cnpj, c.ano, c.numero_sequencial),
  };
}

/** Itens de uma contratação que contêm todas as palavras e têm resultado → amostras normalizadas. */
async function precosDaContratacao(db, c, termo, o) {
  const base = `${BASE}/api/pncp/v1/orgaos/${c.orgao_cnpj}/compras/${c.ano}/${c.numero_sequencial}/itens`;
  const itens = [];
  for (let pagina = 1; ; pagina++) {
    const lote = (await obterJson(db, montarUrl(base, { pagina, tamanhoPagina: ITENS_PAGINA }), o)) || [];
    itens.push(...lote);
    if (lote.length < ITENS_PAGINA) break;
  }
  const alvos = filtrarPorPalavras(itens.filter((i) => i.temResultado), termo);
  const porItem = await Promise.all(alvos.map(async (i) => {
    const resultados = (await obterJson(db, `${base}/${i.numeroItem}/resultados`, o)) || []; // 204 = sem resultado
    return resultados.filter(resultadoValido).map((r) => normalizarResultado(c, i, r));
  }));
  return porItem.flat();
}

/**
 * Preços homologados no PNCP. A busca do portal acha as contratações pelos termos; os itens são
 * conferidos localmente (todas as palavras na descrição) e o período vale para a data do resultado.
 */
export async function consultarPrecosPncp(db, { uf, inicio, fim, palavras }, opts = {}) {
  const termo = String(palavras || '').trim();
  if (termo.length < 3) throw new ErroApi('Informe palavras-chave (mín. 3 letras) para buscar no PNCP.');
  const rastro = opts.rastro || criarRastro();
  const o = { ...opts, fila: enfileirar, fonte: FONTE, rastro };

  const contratacoes = [];
  let truncado = false;
  for (let pagina = 1; pagina <= BUSCA_PAGINAS_MAX; pagina++) {
    const json = await obterJson(db, montarUrl(`${BASE}/api/search/`, {
      q: termo, tipos_documento: 'edital', ordenacao: '-data', status: 'todos', ufs: uf || undefined, pagina, tam_pagina: BUSCA_PAGINA,
    }), o);
    const lote = json?.items || [];
    contratacoes.push(...lote.filter((c) => c.tem_resultado && !c.cancelado));
    // shortcut: para na 1ª página publicada antes de `inicio`; resultado homologado depois disso, de edital mais antigo, fica de fora.
    const ultima = dia(lote.at(-1)?.data_publicacao_pncp);
    if (lote.length < BUSCA_PAGINA || (inicio && ultima && ultima < inicio)) break;
    if (pagina === BUSCA_PAGINAS_MAX) truncado = true;
  }
  if (contratacoes.length > LIMITE_CONTRATACOES) truncado = true;
  const alvo = contratacoes.slice(0, LIMITE_CONTRATACOES);

  const lotes = await Promise.allSettled(alvo.map((c) => precosDaContratacao(db, c, termo, o)));
  const falhas = lotes.filter((l) => l.status === 'rejected');
  if (falhas.length && falhas.length === lotes.length) throw falhas[0].reason;

  const registros = lotes.flatMap((l) => (l.status === 'fulfilled' ? l.value : []))
    .filter((r) => (!inicio || r.dataCompra >= inicio) && (!fim || r.dataCompra <= fim));
  registros.sort((a, b) => String(b.dataCompra).localeCompare(String(a.dataCompra)));
  const avisos = [];
  if (falhas.length) avisos.push(`PNCP: ${falhas.length} de ${lotes.length} contratação(ões) não responderam; tente de novo mais tarde.`);
  if (truncado) avisos.push(`PNCP: examinadas as ${alvo.length} contratações com resultado mais recentes; refine as palavras ou a UF.`);
  return { registros, totalNaFonte: registros.length, truncado, avisos, cache: rastro.resumo(), consultadoEm: new Date().toISOString() };
}
