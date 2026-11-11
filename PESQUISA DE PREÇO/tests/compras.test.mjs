import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarRegistro, filtrarPorPalavras, montarUrl, obterJson, consultarPrecos, linkCompra, ErroApi } from '../server/compras.mjs';
import { consultasFts } from '../server/catalogo.mjs';
import { abrirBanco } from '../server/db.mjs';

// Registro REAL devolvido pela API em 17/10/2026 (PDM 284, MS), reduzido aos campos usados.
const REGISTRO = {
  idCompra: 16014505900032026, dataCompra: '2026-08-13', forma: 'SISRP', modalidade: 5, numeroItemCompra: 95,
  niFornecedor: '56385366000180', codigoItemCatalogo: 476383, quantidade: 200, precoUnitario: 6.2,
  descricaoItem: 'TINTA IMPRESSORA, COR: PRETA', siglaUnidadeFornecimento: 'UN', nomeFornecedor: 'STAR MIX COMERCIO DE PAPELARIA E VARIEDADES LTDA',
  marca: 'TINTA EPSON T544', dataResultado: '2026-08-13', codigoUasg: '160145', nomeUasg: '17. BATALHAO DE FRONTEIRA-MEX',
  nomeOrgao: 'COMANDO DO EXERCITO', estado: 'MS', municipio: 'CORUMBÁ', esfera: 'F', idCompraItem: '1601450590003202600095',
  objetoCompra: 'Objeto: Pregão Eletrônico', descricaoDetalhadaItem: 'TINTA IMPRESSORA, COR PRETA, APLICAÇÃO IMPRESSORA HP',
};

describe('normalização', () => {
  test('mapeia o registro real para o formato interno', () => {
    const r = normalizarRegistro(REGISTRO);
    assert.equal(r.chaveOrigem, '1601450590003202600095');
    assert.equal(r.precoUnitario, 6.2);
    assert.equal(r.uf, 'MS');
    assert.equal(r.esfera, 'Federal');
    assert.equal(r.unidade, 'UN');
    assert.equal(r.orgao, 'COMANDO DO EXERCITO — 17. BATALHAO DE FRONTEIRA-MEX');
    assert.equal(r.link, linkCompra(16014505900032026));
  });
  test('filtro por palavras ignora acento e caixa e exige todas', () => {
    const regs = [normalizarRegistro(REGISTRO), { ...normalizarRegistro(REGISTRO), descricao: 'TINTA AZUL' }];
    assert.equal(filtrarPorPalavras(regs, 'aplicacao preta').length, 1);
    assert.equal(filtrarPorPalavras(regs, 'tinta').length, 2);
    assert.equal(filtrarPorPalavras(regs, '').length, 2);
  });
  test('URL omite parâmetros vazios', () => {
    const u = new URL(montarUrl('/x', { a: 1, b: '', c: null, d: undefined }));
    assert.deepEqual([...u.searchParams.keys()], ['a']);
  });
});

describe('cliente HTTP', () => {
  const resposta = (status, corpo) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

  test('pagina, filtra preço inválido e usa cache na 2ª chamada', async () => {
    const db = abrirBanco(':memory:');
    let chamadas = 0;
    const fetchImpl = async (url) => {
      chamadas++;
      const pagina = Number(new URL(url).searchParams.get('pagina'));
      return resposta(200, pagina === 1
        ? { resultado: [REGISTRO, { ...REGISTRO, idCompraItem: 'x2', precoUnitario: 0 }], totalRegistros: 3, paginasRestantes: 1 }
        : { resultado: [{ ...REGISTRO, idCompraItem: 'x3', precoUnitario: 8 }], totalRegistros: 3, paginasRestantes: 0 });
    };
    const r = await consultarPrecos(db, { tipo: 'material', codigoTipo: 'pdm', codigo: '284' }, { fetchImpl });
    assert.equal(chamadas, 2);
    assert.equal(r.registros.length, 2); // preço 0 descartado
    assert.equal(r.totalNaFonte, 3);
    await consultarPrecos(db, { tipo: 'material', codigoTipo: 'pdm', codigo: '284' }, { fetchImpl });
    assert.equal(chamadas, 2, 'segunda consulta deve vir do cache');
  });

  test('não repete erro 400 e devolve a mensagem da API', async () => {
    let chamadas = 0;
    const fetchImpl = async () => { chamadas++; return resposta(400, { detail: 'tamanhoPagina inválido' }); };
    await assert.rejects(obterJson(null, 'https://exemplo/x', { fetchImpl }), (e) => e instanceof ErroApi && /tamanhoPagina inválido/.test(e.message));
    assert.equal(chamadas, 1);
  });

  test('repete em 503 e conclui quando o servidor volta', async () => {
    let chamadas = 0;
    const fetchImpl = async () => (++chamadas < 2 ? resposta(503, {}) : resposta(200, { ok: true }));
    assert.deepEqual(await obterJson(null, 'https://exemplo/y', { fetchImpl }), { ok: true });
    assert.equal(chamadas, 2);
  });
});

describe('busca no catálogo', () => {
  test('consultas FTS seguras contra aspas e operadores', () => {
    const q = consultasFts('papel "a4" OR x; DROP');
    assert.ok(q.every((s) => !/""/.test(s)));
    assert.match(q[0], /^"papel" AND "a4" AND "OR" AND "DROP"$/);
  });
  test('texto curto demais não gera consulta', () => {
    assert.deepEqual(consultasFts('a'), []);
  });
});
