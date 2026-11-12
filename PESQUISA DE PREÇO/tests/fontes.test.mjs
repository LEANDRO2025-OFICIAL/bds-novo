// Contrato único de fonte de preços e registro de fontes (server/fontes.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FONTES, ESTADO_VIA_PNCP, obterFonte, idsDiretas, descreverFontes, buscarNaFonte } from '../server/fontes.mjs';
import { IDS_PORTAIS, PORTAIS_PRIVADOS, portalValido } from '../server/portal-origem.mjs';
import { abrirBanco } from '../server/db.mjs';

const resposta = (status, corpo) => ({ ok: status < 400, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) });

describe('registro de fontes', () => {
  test('sete fontes: duas diretas (Compras.gov.br, PNCP) e cinco via PNCP', () => {
    assert.deepEqual(FONTES.map((f) => f.id), ['compras', 'pncp', ...PORTAIS_PRIVADOS]);
    assert.deepEqual(idsDiretas(), ['compras', 'pncp']);
    assert.deepEqual(FONTES.filter((f) => f.modo === 'via-pncp').map((f) => f.id), PORTAIS_PRIVADOS);
  });
  test('toda fonte cumpre o contrato', () => {
    for (const f of FONTES) {
      for (const campo of ['id', 'nome', 'modo', 'portal', 'estado', 'verificado']) assert.equal(typeof f[campo], 'string', `${f.id}.${campo}`);
      assert.ok(IDS_PORTAIS.includes(f.portal), `${f.id}: portal conhecido`);
      assert.ok(Array.isArray(f.buscaPor));
      assert.ok(['direta', 'via-pncp'].includes(f.modo));
      assert.equal(typeof f.buscar === 'function', f.modo === 'direta', `${f.id}: só fonte direta tem buscar()`);
    }
  });
  test('portais privados: sem conector direto e com o estado explícito', () => {
    for (const id of PORTAIS_PRIVADOS) {
      const f = obterFonte(id);
      assert.equal(f.buscar, null);
      assert.equal(f.estado, ESTADO_VIA_PNCP);
      assert.match(f.estado, /via PNCP; consulta direta ao portal não implementada/);
      assert.match(f.verificado, /Nenhuma API deste portal foi consultada/);
    }
  });
  test('descreverFontes não expõe funções e marca consultaDireta', () => {
    const lista = descreverFontes();
    assert.equal(lista.length, 7);
    assert.ok(lista.every((f) => !('buscar' in f)));
    assert.deepEqual(lista.filter((f) => f.consultaDireta).map((f) => f.id), ['compras', 'pncp']);
    assert.equal(lista.find((f) => f.id === 'bnc').portalNome, 'BNC — Bolsa Nacional de Compras');
    assert.doesNotThrow(() => JSON.stringify(lista));
  });
  test('obterFonte de id desconhecido → null', () => assert.equal(obterFonte('inexistente'), null));
});

describe('buscarNaFonte', () => {
  test('fonte via PNCP não finge consulta: rejeita com mensagem clara, sem tocar a rede', async () => {
    let chamadas = 0;
    const fetchImpl = async () => { chamadas += 1; return resposta(200, {}); };
    for (const id of PORTAIS_PRIVADOS) await assert.rejects(buscarNaFonte(id, null, { palavras: 'papel' }, { fetchImpl }), /consulta direta ao portal não implementada/);
    assert.equal(chamadas, 0);
    await assert.rejects(buscarNaFonte('nada', null, {}), /Fonte desconhecida/);
  });

  test('Compras.gov.br pelo contrato: amostras normalizadas com portal de origem', async () => {
    const db = abrirBanco(':memory:');
    const fetchImpl = async () => resposta(200, { totalRegistros: 2, paginasRestantes: 0, resultado: [
      { idCompraItem: 'a1', idCompra: '1', precoUnitario: 10.5, dataResultado: '2026-09-01', descricaoItem: 'PAPEL A4', nomeOrgao: 'ORGAO', estado: 'DF' },
      { idCompraItem: 'a2', idCompra: '1', precoUnitario: 0, descricaoItem: 'PAPEL A4' }, // preço zero é descartado pela fonte
    ] });
    const r = await buscarNaFonte('compras', db, { tipo: 'material', codigoTipo: 'pdm', codigo: '123' }, { fetchImpl });
    assert.equal(r.registros.length, 1);
    assert.equal(r.registros[0].portalOrigem, 'comprasgov');
    assert.equal(r.registros[0].precoUnitario, 10.5);
    assert.deepEqual(r.avisos, []);
    assert.equal(typeof r.consultadoEm, 'string');
    assert.equal(r.totalNaFonte, 2);
    assert.equal(r.truncado, false);
  });

  test('PNCP pelo contrato: usa termoPncp quando não há palavras-chave e classifica o portal de origem', async () => {
    const db = abrirBanco(':memory:');
    const c = { numero_controle_pncp: 'x-1', orgao_cnpj: '11111111000111', ano: '2026', numero_sequencial: '7', tem_resultado: true, cancelado: false, data_publicacao_pncp: '2026-10-01T10:00:00' };
    let buscado = null;
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/api/search/') { buscado = u.searchParams.get('q'); return resposta(200, { items: [c] }); }
      if (u.pathname.startsWith('/api/consulta/')) return resposta(200, { linkSistemaOrigem: 'https://bllcompras.com/Process/ProcessView?param1=1', usuarioNome: 'BLL Compras' });
      if (u.pathname.endsWith('/itens')) return resposta(200, [{ numeroItem: 1, descricao: 'PAPEL SULFITE A4', temResultado: true, unidadeMedida: 'RESMA' }]);
      if (u.pathname.endsWith('/resultados')) return resposta(200, [{ valorUnitarioHomologado: 22.9, dataResultado: '2026-10-05', sequencialResultado: 1, niFornecedor: '1' }]);
      return resposta(404, {});
    };
    const r = await buscarNaFonte('pncp', db, { termoPncp: 'papel sulfite', palavras: '' }, { fetchImpl });
    assert.equal(buscado, 'papel sulfite');
    assert.equal(r.registros.length, 1);
    assert.equal(r.registros[0].portalOrigem, 'bll');
    assert.ok(r.registros.every((x) => portalValido(x.portalOrigem)));
  });
});
