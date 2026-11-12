import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PORTAIS, IDS_PORTAIS, PORTAIS_PRIVADOS, classificarPortal, portalPorDominio, portalPorNome, hostDe, nomePortal, portalValido, coberturaPorPortal } from '../server/portal-origem.mjs';

describe('portal de origem: tabela', () => {
  test('tem exatamente as oito categorias pedidas, sem id repetido', () => {
    assert.deepEqual(IDS_PORTAIS, ['comprasgov', 'portal-de-compras-publicas', 'bll', 'bnc', 'licitanet', 'licitar-digital', 'pncp', 'outro']);
    assert.equal(new Set(IDS_PORTAIS).size, PORTAIS.length);
    assert.deepEqual(PORTAIS_PRIVADOS, ['portal-de-compras-publicas', 'bll', 'bnc', 'licitanet', 'licitar-digital']);
  });
  test('nenhum domínio aparece em dois portais', () => {
    const todos = PORTAIS.flatMap((p) => p.dominios);
    assert.equal(new Set(todos).size, todos.length);
  });
  test('nomePortal e portalValido', () => {
    assert.equal(nomePortal('bll'), 'BLL Compras');
    assert.equal(nomePortal('inexistente'), '—');
    assert.equal(nomePortal(null), '—');
    assert.equal(portalValido('licitanet'), true);
    assert.equal(portalValido('toString'), false);
    assert.equal(portalValido(undefined), false);
  });
});

describe('portal de origem: por domínio', () => {
  const casos = [
    ['https://www.comprasnet.gov.br/seguro/loginPortal.asp', 'comprasgov'],
    ['https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=123', 'comprasgov'],
    ['https://www.gov.br.compras.gov.br/x', 'comprasgov'],
    ['https://www.portaldecompraspublicas.com.br/processos/ms/prefeitura-x/pe-30-2026', 'portal-de-compras-publicas'],
    ['http://operacao.portaldecompraspublicas.com.br/18/Processos/', 'portal-de-compras-publicas'],
    ['https://bll.org.br/', 'bll'],
    ['https://bllcompras.com/Process/ProcessView?param1=abc', 'bll'],
    ['https://bnc.org.br/sistema/', 'bnc'],
    ['https://bnccompras.com/Process/ProcessView?param1=abc', 'bnc'],
    ['https://www.licitanet.com.br/processos/1234', 'licitanet'],
    ['https://portal.licitanet.com.br/x', 'licitanet'],
    ['https://licitardigital.com.br/pesquisa/abc', 'licitar-digital'],
    ['https://app2.licitardigital.com.br/', 'licitar-digital'],
    ['https://pncp.gov.br/app/editais/03563335000106/2026/63', 'pncp'],
  ];
  for (const [url, esperado] of casos) test(`${new URL(url).hostname} → ${esperado}`, () => assert.equal(portalPorDominio(url), esperado));

  test('aceita endereço sem esquema, com maiúsculas e ponto final', () => {
    assert.equal(portalPorDominio('WWW.Licitanet.com.br/processos'), 'licitanet');
    assert.equal(portalPorDominio('https://bll.org.br./x'), 'bll');
  });
  test('sufixo parecido não engana: só o domínio ou subdomínio casa', () => {
    assert.equal(portalPorDominio('https://falsobll.org.br/'), null);
    assert.equal(portalPorDominio('https://bll.org.br.exemplo.com/'), null);
    assert.equal(portalPorDominio('https://exemplo.com/?u=licitanet.com.br'), null);
  });
  test('URL malformada, vazia ou de outro esquema → null', () => {
    for (const ruim of [null, undefined, '', '   ', 'não é url', 'http://', 'javascript:alert(1)', 'ftp://bll.org.br/x', 'localhost', 12345, {}, 'https://[::1'])
      assert.equal(portalPorDominio(ruim), null, String(ruim));
    assert.equal(hostDe('https://www.Exemplo.com.br:8443/a'), 'exemplo.com.br');
  });
});

describe('portal de origem: por nome do sistema', () => {
  const casos = [
    ['Compras.gov.br', 'comprasgov'], ['COMPRASGOV', 'comprasgov'], ['Comprasnet 4.0', 'comprasgov'],
    ['Portal de Compras Públicas', 'portal-de-compras-publicas'], ['PORTAL DE COMPRAS PUBLICAS LTDA', 'portal-de-compras-publicas'],
    ['BLL Compras', 'bll'], ['Bolsa de Licitações do Brasil - BLL', 'bll'],
    ['BNC', 'bnc'], ['Bolsa Nacional de Compras', 'bnc'],
    ['Licitanet Licitações Eletrônicas', 'licitanet'],
    ['Licitar Digital', 'licitar-digital'], ['LICITARDIGITAL', 'licitar-digital'],
  ];
  for (const [nome, esperado] of casos) test(`“${nome}” → ${esperado}`, () => assert.equal(portalPorNome(nome), esperado));
  test('siglas só casam como palavra inteira; nome desconhecido ou ausente → null', () => {
    assert.equal(portalPorNome('Sistema Abllo de Gestão'), null);
    assert.equal(portalPorNome('Prefeitura de Bncópolis'), null);
    assert.equal(portalPorNome('Betha Sistemas'), null);
    assert.equal(portalPorNome(null), null);
    assert.equal(portalPorNome(''), null);
  });
});

describe('classificarPortal', () => {
  test('fonte Compras.gov.br é sempre comprasgov', () => {
    assert.equal(classificarPortal({ origem: 'compras.gov.br' }), 'comprasgov');
    assert.equal(classificarPortal({ origem: 'compras.gov.br', link: null }), 'comprasgov');
  });
  test('PNCP: o link do sistema de origem decide', () => {
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: 'https://bllcompras.com/Process/1', link: 'https://pncp.gov.br/app/editais/1/2026/1' }), 'bll');
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: 'https://www.gov.br/compras/pt-br', sistema: 'Licitanet' }), 'licitanet');
  });
  test('PNCP: sem link, o nome do sistema decide', () => {
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: null, sistema: 'Portal de Compras Públicas' }), 'portal-de-compras-publicas');
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: 'lixo sem sentido', sistema: 'BNC' }), 'bnc');
  });
  test('PNCP sem campo nenhum, ou só com link do próprio PNCP, fica como pncp (origem não identificada)', () => {
    assert.equal(classificarPortal({ origem: 'pncp' }), 'pncp');
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: 'https://pncp.gov.br/app/editais/1/2026/1' }), 'pncp');
    assert.equal(classificarPortal({ origem: 'pncp', linkSistemaOrigem: 'https://licitacoes.prefeitura-x.ms.gov.br/1', sistema: 'Sistema Próprio' }), 'pncp');
    assert.equal(classificarPortal({ link: 'https://pncp.gov.br/app/editais/1/2026/1' }), 'pncp');
  });
  test('cotação/lançamento manual: classifica pelo link; sem pista é outro', () => {
    assert.equal(classificarPortal({ origem: 'contratacao-similar', link: 'https://www.licitanet.com.br/p/9' }), 'licitanet');
    assert.equal(classificarPortal({ origem: 'cotacao-fornecedor', link: 'https://loja.exemplo.com.br/produto' }), 'outro');
    assert.equal(classificarPortal({ origem: 'manual' }), 'outro');
    assert.equal(classificarPortal(), 'outro');
    assert.equal(classificarPortal({}), 'outro');
  });
});

describe('coberturaPorPortal', () => {
  test('conta por portal, mostra zeros e separa as sem origem identificável', () => {
    const c = coberturaPorPortal([
      { portal_origem: 'bll', incluida: true }, { portal_origem: 'bll', incluida: false },
      { portal_origem: 'pncp', incluida: true }, { portalOrigem: 'comprasgov', incluida: true },
      { portal_origem: null, origem: 'pncp', link: 'https://pncp.gov.br/x', incluida: true }, // banco antigo, sem coluna preenchida
      { portal_origem: 'valor-estranho', origem: 'cotacao-fornecedor', incluida: true },
    ]);
    assert.equal(c.total, 6);
    assert.equal(c.semOrigem, 2);
    assert.equal(c.outros, 1);
    assert.equal(c.identificadas, 3);
    assert.deepEqual(c.porPortal.map((p) => p.portal), IDS_PORTAIS);
    const de = (id) => c.porPortal.find((p) => p.portal === id);
    assert.deepEqual([de('bll').amostras, de('bll').consideradas], [2, 1]);
    assert.equal(de('licitanet').amostras, 0);
    assert.equal(de('comprasgov').amostras, 1);
  });
  test('lista vazia', () => {
    const c = coberturaPorPortal([]);
    assert.deepEqual([c.total, c.identificadas, c.semOrigem, c.outros], [0, 0, 0, 0]);
    assert.equal(c.porPortal.length, PORTAIS.length);
  });
});
