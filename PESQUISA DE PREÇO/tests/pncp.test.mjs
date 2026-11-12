import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarResultado, consultarPrecosPncp, linkContratacao, BUSCA_PAGINA } from '../server/pncp.mjs';
import { criarFila, ErroApi } from '../server/compras.mjs';
import { abrirBanco } from '../server/db.mjs';

// Registros REAIS do PNCP em 17/10/2026 (Município de Aparecida do Taboado/MS, compra 63/2026), reduzidos aos campos usados.
const CONTRATACAO = {
  numero_controle_pncp: '03563335000106-1-000063/2026', orgao_cnpj: '03563335000106', orgao_nome: 'MUNICIPIO DE APARECIDA DO TABOADO',
  unidade_codigo: '1', unidade_nome: 'PREFEITURA MUNICIPAL DE APARECIDA DO TABOADO - MS', esfera_id: 'M', esfera_nome: 'Municipal',
  municipio_nome: 'Aparecida do Taboado', uf: 'MS', ano: '2026', numero_sequencial: '63', modalidade_licitacao_nome: 'Pregão - Eletrônico',
  data_publicacao_pncp: '2026-10-15T11:09:01.721601', tem_resultado: true, cancelado: false,
  description: 'AQUISIÇÃO DE EQUIPAMENTOS FRACASSADOS NO PREGÃO ELETRÔNICO Nº 030/2026 PARA SALA DE AEE DA ESCOLA MUNICIPAL JOÃO CHAMA',
};
const ITEM = {
  numeroItem: 2, descricao: 'IMPRESSORA MULTIFUNCIONAL A3 WIFI 127V COLORIDA: Tecnologia de impressão: jato de tinta',
  materialOuServico: 'M', valorUnitarioEstimado: 4019, quantidade: 1, unidadeMedida: 'UN', temResultado: true, catalogoCodigoItem: null,
};
const RESULTADO = {
  niFornecedor: '57316498000113', nomeRazaoSocialFornecedor: 'STYLE COMERCIO E SERVICOS LTDA', numeroItem: 2, valorTotalHomologado: 4018.89,
  quantidadeHomologada: 1, valorUnitarioHomologado: 4018.89, dataResultado: '2026-10-14', dataCancelamento: '0001-01-01T00:00:00',
  moedaEstrangeira: null, situacaoCompraItemResultadoId: 1, situacaoCompraItemResultadoNome: 'Informado', sequencialResultado: 1,
};

// Dados da contratação: formato do contrato publicado (linkSistemaOrigem, usuarioNome). Valores ILUSTRATIVOS, não capturados ao vivo.
const COMPRA = { numeroControlePNCP: '03563335000106-1-000063/2026', linkSistemaOrigem: 'https://www.portaldecompraspublicas.com.br/processos/ms/x/pe-63-2026', usuarioNome: 'Portal de Compras Públicas' };

const resposta = (status, corpo) => ({ ok: status < 400, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) });

describe('normalização PNCP', () => {
  test('mapeia contratação + item + resultado reais para o formato de amostra', () => {
    const r = normalizarResultado(CONTRATACAO, ITEM, RESULTADO);
    assert.equal(r.origem, 'pncp');
    assert.equal(r.chaveOrigem, 'pncp-03563335000106-1-000063/2026-2-1');
    assert.equal(r.dataCompra, '2026-10-14');
    assert.equal(r.precoUnitario, 4018.89);
    assert.equal(r.orgao, 'MUNICIPIO DE APARECIDA DO TABOADO — PREFEITURA MUNICIPAL DE APARECIDA DO TABOADO - MS');
    assert.equal(r.municipio, 'Aparecida do Taboado');
    assert.equal(r.uf, 'MS');
    assert.equal(r.esfera, 'Municipal');
    assert.equal(r.fornecedorNome, 'STYLE COMERCIO E SERVICOS LTDA');
    assert.equal(r.unidade, 'UN');
    assert.equal(r.link, 'https://pncp.gov.br/app/editais/03563335000106/2026/63');
    assert.equal(r.link, linkContratacao('03563335000106', '2026', '63'));
    assert.equal(r.portalOrigem, 'pncp', 'sem dados da contratação a origem não é identificável');
  });

  test('portal de origem: link do sistema de origem, depois nome de quem publicou; ausência → pncp', () => {
    const po = (compra) => normalizarResultado(CONTRATACAO, ITEM, RESULTADO, compra).portalOrigem;
    assert.equal(po(COMPRA), 'portal-de-compras-publicas');
    assert.equal(po({ linkSistemaOrigem: 'https://bllcompras.com/Process/ProcessView?param1=1' }), 'bll');
    assert.equal(po({ linkSistemaOrigem: null, usuarioNome: 'Licitanet Licitações Eletrônicas' }), 'licitanet');
    assert.equal(po({ linkSistemaOrigem: 'isto não é url', usuarioNome: 'Licitar Digital' }), 'licitar-digital');
    assert.equal(po({ linkSistemaOrigem: 'https://bnc.org.br/sistema' }), 'bnc');
    assert.equal(po({ usuarioNome: 'Compras.gov.br' }), 'comprasgov');
    assert.equal(po({}), 'pncp');
    assert.equal(po({ linkSistemaOrigem: '', usuarioNome: '' }), 'pncp');
    assert.equal(po(null), 'pncp');
  });
});

describe('consulta PNCP com fetch falso', () => {
  // Busca: uma contratação com resultado (a real), uma sem resultado e uma cancelada.
  const busca = { total: 3, items: [CONTRATACAO, { ...CONTRATACAO, numero_sequencial: '64', tem_resultado: false }, { ...CONTRATACAO, numero_sequencial: '65', cancelado: true }] };
  const itens = [
    ITEM,
    { ...ITEM, numeroItem: 1, descricao: 'ENCADERNADORA PERFURADORA PARA ESPIRAL A3' }, // não tem as palavras
    { ...ITEM, numeroItem: 3, descricao: 'TINTA PARA IMPRESSORA EPSON 664 PRETA' },
    { ...ITEM, numeroItem: 4, descricao: 'TINTA IMPRESSORA CIANO', temResultado: false },
  ];
  const resultados = {
    2: [RESULTADO, { ...RESULTADO, sequencialResultado: 2, situacaoCompraItemResultadoNome: 'Cancelado', dataCancelamento: '2026-10-15T00:00:00' }],
    3: [{ ...RESULTADO, numeroItem: 3, valorUnitarioHomologado: 52.5, dataResultado: '2025-01-10' }], // fora do período
  };
  const falso = () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname === '/api/search/') return resposta(200, busca);
      if (u.pathname === '/api/consulta/v1/orgaos/03563335000106/compras/2026/63') return resposta(200, COMPRA);
      const m = u.pathname.match(/\/itens(?:\/(\d+)\/resultados)?$/);
      if (m && !m[1]) return resposta(200, Number(u.searchParams.get('pagina')) === 1 ? itens : []);
      if (m) return resultados[m[1]] ? resposta(200, resultados[m[1]]) : resposta(204);
      return resposta(404, { message: 'não encontrado' });
    };
    return { urls, fetchImpl };
  };

  test('filtra itens pelas palavras, descarta cancelados e fora do período, e usa cache', async () => {
    const db = abrirBanco(':memory:');
    const { urls, fetchImpl } = falso();
    const filtros = { uf: 'MS', inicio: '2025-10-17', fim: '2026-10-17', palavras: 'tinta impressora' };
    const r = await consultarPrecosPncp(db, filtros, { fetchImpl });
    assert.equal(r.registros.length, 1);
    assert.equal(r.registros[0].precoUnitario, 4018.89);
    assert.equal(r.registros[0].link, 'https://pncp.gov.br/app/editais/03563335000106/2026/63');
    assert.deepEqual(r.avisos, []);

    const busc = new URL(urls.find((u) => u.includes('/api/search/')));
    assert.equal(busc.searchParams.get('q'), 'tinta impressora');
    assert.equal(busc.searchParams.get('ufs'), 'MS');
    assert.equal(busc.searchParams.get('tam_pagina'), String(BUSCA_PAGINA));
    assert.ok(!urls.some((u) => u.includes('/compras/2026/64/') || u.includes('/compras/2026/65/')), 'sem resultado ou cancelada não é consultada');
    assert.ok(!urls.some((u) => u.includes('/itens/1/') || u.includes('/itens/4/')), 'só itens com as palavras e com resultado');
    assert.equal(urls.length, 5, 'busca + itens + 2 resultados + dados da contratação (portal de origem)');
    assert.equal(r.registros[0].portalOrigem, 'portal-de-compras-publicas');
    assert.equal(r.registros[0].sistemaOrigem, 'Portal de Compras Públicas');
    assert.equal(r.registros[0].linkSistemaOrigem, COMPRA.linkSistemaOrigem);

    const n = urls.length;
    await consultarPrecosPncp(db, filtros, { fetchImpl });
    assert.equal(urls.length, n, 'segunda consulta deve vir do cache');
  });

  test('exige palavras-chave', async () => {
    await assert.rejects(consultarPrecosPncp(null, { palavras: ' a ' }), (e) => e instanceof ErroApi && /palavras-chave/.test(e.message));
  });

  test('contratação que falha vira aviso; falha geral vira erro', async () => {
    const outra = { ...CONTRATACAO, orgao_cnpj: '99999999000199' };
    const fetchImpl = async (url) => {
      if (url.includes('/api/search/')) return resposta(200, { total: 2, items: [CONTRATACAO, outra] });
      if (url.includes('99999999000199')) return resposta(400, { message: 'cnpj inválido' });
      if (/\/itens\?/.test(url)) return resposta(200, [ITEM]);
      return resposta(200, [RESULTADO]);
    };
    const r = await consultarPrecosPncp(null, { palavras: 'impressora' }, { fetchImpl });
    assert.equal(r.registros.length, 1);
    assert.match(r.avisos[0], /1 de 2 contratação/);

    const fora = async (url) => (url.includes('/api/search/') ? resposta(200, { items: [outra] }) : resposta(400, { message: 'x' }));
    await assert.rejects(consultarPrecosPncp(null, { palavras: 'impressora' }, { fetchImpl: fora }), ErroApi);
  });

  test('dados da contratação indisponíveis (404 ou rede) não derrubam a consulta: preço entra como pncp', async () => {
    const db = abrirBanco(':memory:');
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/api/search/') return resposta(200, { items: [CONTRATACAO] });
      if (u.pathname.includes('/api/consulta/')) throw new Error('rede caiu');
      if (u.pathname.endsWith('/itens')) return resposta(200, [ITEM]);
      if (u.pathname.endsWith('/itens/2/resultados')) return resposta(200, [RESULTADO]);
      return resposta(404, {});
    };
    const r = await consultarPrecosPncp(db, { palavras: 'impressora' }, { fetchImpl, dormirImpl: async () => {} });
    assert.equal(r.registros.length, 1);
    assert.equal(r.registros[0].portalOrigem, 'pncp');
    assert.deepEqual(r.avisos, []);
  });
});

test('fila respeita o limite de chamadas simultâneas', async () => {
  const enfileirar = criarFila(2);
  let ativos = 0;
  let pico = 0;
  const tarefa = () => enfileirar(async () => {
    pico = Math.max(pico, ++ativos);
    await new Promise((r) => setTimeout(r, 5));
    ativos--;
  });
  await Promise.all(Array.from({ length: 6 }, tarefa));
  assert.equal(pico, 2);
  await assert.rejects(enfileirar(async () => { throw new Error('falhou'); }), /falhou/);
  assert.equal(await enfileirar(async () => 'segue'), 'segue', 'erro não trava a fila');
});
