// Integração de portais: portal de origem persistido, exibido (API, CSV, mapa) e migração de bancos antigos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrirBanco } from '../server/db.mjs';

process.env.DB_PATH = ':memory:';
delete process.env.USUARIOS;
const { servidor } = await import('../server/server.mjs');

let base;
before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(base + caminho, { method: metodo, headers: corpo ? { 'content-type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, corpo: tipo.includes('json') ? await res.json() : await res.text(), headers: res.headers };
}
async function novoItem(titulo = 'Integrações') {
  const p = await chamar('POST', '/api/pesquisas', { titulo });
  const it = await chamar('POST', `/api/pesquisas/${p.corpo.id}/itens`, { descricao: 'Papel sulfite A4', quantidade: 10, unidade: 'RESMA' });
  return { pid: p.corpo.id, iid: it.corpo.id };
}
const AMOSTRAS = [
  { origem: 'compras.gov.br', chaveOrigem: 'c1', precoUnitario: 20, link: 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=1' },
  { origem: 'pncp', chaveOrigem: 'p1', precoUnitario: 21, portalOrigem: 'bll', link: 'https://pncp.gov.br/app/editais/1/2026/1' },
  { origem: 'pncp', chaveOrigem: 'p2', precoUnitario: 22, linkSistemaOrigem: 'https://www.licitanet.com.br/p/2', link: 'https://pncp.gov.br/app/editais/1/2026/2' },
  { origem: 'pncp', chaveOrigem: 'p3', precoUnitario: 23, sistemaOrigem: 'Licitar Digital', link: 'https://pncp.gov.br/app/editais/1/2026/3' },
  { origem: 'pncp', chaveOrigem: 'p4', precoUnitario: 24, link: 'https://pncp.gov.br/app/editais/1/2026/4' },
  { origem: 'pncp', chaveOrigem: 'p5', precoUnitario: 25, portalOrigem: 'portal-inventado', link: 'https://pncp.gov.br/app/editais/1/2026/5' },
  { origem: 'cotacao-fornecedor', chaveOrigem: 'm1', precoUnitario: 26 },
  { origem: 'contratacao-similar', chaveOrigem: 'm2', precoUnitario: 27, link: 'https://bnc.org.br/sistema/processo/9' },
];

test('amostra guarda o portal de origem: informado, deduzido do sistema/link ou não identificado', async () => {
  const { iid } = await novoItem();
  const r = await chamar('POST', `/api/itens/${iid}/amostras`, { amostras: AMOSTRAS });
  assert.equal(r.corpo.inseridas, AMOSTRAS.length);
  const porChave = Object.fromEntries(r.corpo.item.amostras.map((a) => [a.chave_origem, a]));
  assert.equal(porChave.c1.portal_origem, 'comprasgov');
  assert.equal(porChave.p1.portal_origem, 'bll');
  assert.equal(porChave.p1.portal_nome, 'BLL Compras');
  assert.equal(porChave.p2.portal_origem, 'licitanet');
  assert.equal(porChave.p3.portal_origem, 'licitar-digital');
  assert.equal(porChave.p4.portal_origem, 'pncp', 'PNCP sem pista: origem não identificada');
  assert.equal(porChave.p5.portal_origem, 'pncp', 'id de portal desconhecido é ignorado, não gravado');
  assert.equal(porChave.m1.portal_origem, 'outro');
  assert.equal(porChave.m2.portal_origem, 'bnc', 'lançamento manual com link de portal conhecido');
});

test('CSV e mapa de preços mostram o portal de origem', async () => {
  const { pid, iid } = await novoItem('CSV e mapa');
  await chamar('POST', `/api/itens/${iid}/amostras`, { amostras: AMOSTRAS });
  const csv = await chamar('GET', `/api/pesquisas/${pid}/csv`);
  const linhas = csv.corpo.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(';'));
  const col = linhas[0].indexOf('Portal de origem');
  assert.ok(col > 0, 'coluna nova no cabeçalho');
  assert.ok(linhas.every((l) => l.length === linhas[0].length), 'todas as linhas com o mesmo número de colunas');
  const portais = linhas.filter((l) => l[4] === 'Amostra').map((l) => l[col]);
  assert.deepEqual(portais.sort(), ['BLL Compras', 'BNC — Bolsa Nacional de Compras', 'Compras.gov.br', 'Licitanet', 'Licitar Digital', 'Outro / não se aplica', 'PNCP (origem não identificada)', 'PNCP (origem não identificada)'].sort());

  const mapa = await chamar('GET', `/api/pesquisas/${pid}/mapa`);
  assert.equal(mapa.status, 200);
  assert.match(mapa.corpo, /Portal de origem: BLL Compras/);
  assert.match(mapa.corpo, /Portal de origem: Licitanet/);
  assert.match(mapa.corpo, /Portal de origem: não identificado \(publicado no PNCP\)/);
  assert.doesNotMatch(mapa.corpo, /Portal de origem: Compras\.gov\.br/, 'não repete o que a fonte já diz');
});

test('banco anterior (sem a coluna portal_origem) é migrado: coluna criada e linhas antigas classificadas', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'bp-portal-'));
  try {
    const caminho = join(pasta, 'antigo.db');
    const antigo = abrirBanco(caminho);
    antigo.exec("INSERT INTO pesquisas (id, titulo) VALUES (1, 'Antiga'); INSERT INTO itens (id, pesquisa_id, descricao, tipo) VALUES (1, 1, 'Item', 'material');");
    // recria a tabela como era antes desta versão (sem portal_origem)
    antigo.exec(`ALTER TABLE amostras DROP COLUMN portal_origem;
      INSERT INTO amostras (item_id, origem, chave_origem, preco_unitario, link) VALUES
        (1, 'compras.gov.br', 'a', 10, NULL),
        (1, 'pncp', 'b', 11, 'https://pncp.gov.br/app/editais/1/2026/1'),
        (1, 'contratacao-similar', 'c', 12, 'https://www.portaldecompraspublicas.com.br/processos/x'),
        (1, 'cotacao-fornecedor', 'd', 13, NULL);`);
    antigo.close();
    assert.ok(!new DatabaseSync(caminho).prepare('PRAGMA table_info(amostras)').all().some((c) => c.name === 'portal_origem'));

    const db = abrirBanco(caminho);
    const linhas = db.prepare('SELECT chave_origem, portal_origem, preco_unitario FROM amostras ORDER BY chave_origem').all();
    assert.deepEqual(linhas.map((l) => l.portal_origem), ['comprasgov', 'pncp', 'portal-de-compras-publicas', 'outro']);
    assert.deepEqual(linhas.map((l) => l.preco_unitario), [10, 11, 12, 13], 'dados preservados');
    // reabrir não altera classificações já gravadas (ex.: corrigidas depois)
    db.prepare("UPDATE amostras SET portal_origem = 'bll' WHERE chave_origem = 'b'").run();
    db.close();
    const de = abrirBanco(caminho);
    assert.equal(de.prepare("SELECT portal_origem FROM amostras WHERE chave_origem = 'b'").get().portal_origem, 'bll');
    de.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('cobertura por portal: no item, na pesquisa e no mapa — com zeros e com as sem origem identificável', async () => {
  const { pid, iid } = await novoItem('Cobertura');
  const add = await chamar('POST', `/api/itens/${iid}/amostras`, { amostras: AMOSTRAS });
  const c = add.corpo.item.cobertura;
  assert.equal(c.total, 8);
  assert.equal(c.semOrigem, 2);
  assert.equal(c.outros, 1);
  assert.equal(c.identificadas, 5);
  const de = (cob, id) => cob.porPortal.find((l) => l.portal === id);
  assert.equal(de(c, 'comprasgov').amostras, 1);
  assert.equal(de(c, 'portal-de-compras-publicas').amostras, 0, 'portal sem amostra aparece com zero');
  assert.equal(c.porPortal.reduce((s, l) => s + l.amostras, 0), c.total, 'toda amostra é contada exatamente uma vez');

  // desconsiderar uma amostra muda "consideradas", não "amostras"
  const alvo = add.corpo.item.amostras.find((a) => a.chave_origem === 'p1');
  const dep = await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: false, justificativa: 'Especificação diferente da pedida.' });
  assert.deepEqual([de(dep.corpo.cobertura, 'bll').amostras, de(dep.corpo.cobertura, 'bll').consideradas], [1, 0]);

  // segundo item: a cobertura da pesquisa soma os itens
  const it2 = await chamar('POST', `/api/pesquisas/${pid}/itens`, { descricao: 'Caneta', quantidade: 1 });
  await chamar('POST', `/api/itens/${it2.corpo.id}/amostras`, { amostras: [{ origem: 'pncp', chaveOrigem: 'z', precoUnitario: 2, portalOrigem: 'bll' }] });
  const p = await chamar('GET', `/api/pesquisas/${pid}`);
  assert.equal(p.corpo.cobertura.total, 9);
  assert.equal(de(p.corpo.cobertura, 'bll').amostras, 2);

  const mapa = await chamar('GET', `/api/pesquisas/${pid}/mapa`);
  assert.match(mapa.corpo, /Cobertura por portal de origem \(9 amostras coletadas\)/);
  assert.match(mapa.corpo, /BLL Compras 2/);
  assert.match(mapa.corpo, /sem portal de origem identificável 2/);
});

test('pesquisa sem amostras: cobertura zerada e mapa sem a linha de cobertura', async () => {
  const { pid } = await novoItem('Vazia');
  const p = await chamar('GET', `/api/pesquisas/${pid}`);
  assert.equal(p.corpo.cobertura.total, 0);
  const mapa = await chamar('GET', `/api/pesquisas/${pid}/mapa`);
  assert.doesNotMatch(mapa.corpo, /Cobertura por portal de origem/);
});

test('GET /api/fontes: duas fontes diretas e cinco portais privados via PNCP, com estado explícito', async () => {
  const r = await chamar('GET', '/api/fontes');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.diretas, ['compras', 'pncp']);
  const viaPncp = r.corpo.fontes.filter((f) => !f.consultaDireta);
  assert.deepEqual(viaPncp.map((f) => f.id), ['portal-de-compras-publicas', 'bll', 'bnc', 'licitanet', 'licitar-digital']);
  assert.ok(viaPncp.every((f) => f.estado === 'Preços obtidos via PNCP; consulta direta ao portal não implementada.'));
});

test('GET /api/precos não aceita portal privado como fonte de consulta', async () => {
  const r = await chamar('GET', '/api/precos?fonte=bll&palavras=papel');
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /Fonte inválida/);
});

test('importação de CSV pela API: simular não grava; importar grava só as válidas; reimportar não duplica', async () => {
  const { iid } = await novoItem('Importação');
  const csv = 'Fornecedor;Preço unitário;Data;UF\r\nACME;10,50;01/10/2026;MS\r\nBETA;11,00;02/10/2026;SP\r\nGAMA;onze;03/10/2026;RJ\r\n';

  const sim = await chamar('POST', `/api/itens/${iid}/importar`, { csv, portal: 'licitanet', simular: true });
  assert.equal(sim.status, 200);
  assert.equal(sim.corpo.simulado, true);
  assert.equal(sim.corpo.relatorio.validas.length, 2);
  assert.deepEqual(sim.corpo.relatorio.rejeitadas.map((x) => x.linha), [4]);
  assert.equal((await chamar('GET', `/api/itens/${iid}`)).corpo.amostras.length, 0, 'simulação não grava nada');

  const imp = await chamar('POST', `/api/itens/${iid}/importar`, { csv, portal: 'licitanet' });
  assert.equal(imp.status, 200);
  assert.deepEqual([imp.corpo.inseridas, imp.corpo.jaExistentes], [2, 0]);
  const a = imp.corpo.item.amostras;
  assert.deepEqual(a.map((x) => [x.preco_unitario, x.origem, x.portal_origem, x.data_compra, x.uf]), [[10.5, 'importacao-csv', 'licitanet', '2026-10-01', 'MS'], [11, 'importacao-csv', 'licitanet', '2026-10-02', 'SP']]);
  assert.equal(imp.corpo.item.cobertura.porPortal.find((l) => l.portal === 'licitanet').amostras, 2);

  const de = await chamar('POST', `/api/itens/${iid}/importar`, { csv, portal: 'licitanet' });
  assert.deepEqual([de.corpo.inseridas, de.corpo.jaExistentes], [0, 2]);
  assert.equal(de.corpo.item.amostras.length, 2);
});

test('importação de CSV pela API: erros do arquivo e do pedido viram 400 com mensagem', async () => {
  const { iid } = await novoItem('Importação com erro');
  const caso = async (corpo, re) => { const r = await chamar('POST', `/api/itens/${iid}/importar`, corpo); assert.equal(r.status, 400); assert.match(r.corpo.erro, re); };
  await caso({ portal: 'bll' }, /Envie o conteúdo do arquivo CSV/);
  await caso({ csv: 'Preço unitário\n10', portal: 'xyz' }, /Escolha o portal de origem/);
  await caso({ csv: 'Fornecedor\nACME', portal: 'bll' }, /coluna de preço unitário/);
  await caso({ csv: 'Preço unitário\nabc\n-5', portal: 'bll' }, /Nenhuma linha válida/);
  assert.equal((await chamar('POST', '/api/itens/999999/importar', { csv: 'Preço unitário\n10', portal: 'bll' })).status, 404);
  assert.equal((await chamar('GET', `/api/itens/${iid}`)).corpo.amostras.length, 0);
  const fontes = await chamar('GET', '/api/fontes');
  assert.equal(fontes.corpo.portais.length, 8);
});
