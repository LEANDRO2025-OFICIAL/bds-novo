// Fluxos novos com banco em ARQUIVO temporário: backup automático, exclusão em lote, trilha de auditoria,
// mapa de preços (HTML para PDF), padrões da pesquisa e migração de banco antigo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const pasta = mkdtempSync(join(tmpdir(), 'bp-fluxos-'));
process.env.DB_PATH = join(pasta, 'dados', 'pesquisa-precos.db'); // a pasta "dados" ainda não existe
process.env.BACKUP_RETENCAO = '5';
delete process.env.USUARIOS;
const { servidor, db } = await import('../server/server.mjs');
const dirBackups = join(pasta, 'dados', 'backups');

let base;
before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.close(); db.close(); rmSync(pasta, { recursive: true, force: true }); });

async function chamar(metodo, caminho, corpo) {
  const res = await fetch(base + caminho, { method: metodo, headers: corpo ? { 'content-type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, corpo: tipo.includes('json') ? await res.json() : await res.text(), headers: res.headers, bytes: null };
}
const backups = () => (existsSync(dirBackups) ? readdirSync(dirBackups).filter((n) => n.endsWith('.db')).sort() : []);
/** Zera o limite de "um por minuto" apagando os backups já feitos (cada teste parte do zero). */
const limparBackups = () => { for (const n of existsSync(dirBackups) ? readdirSync(dirBackups) : []) rmSync(join(dirBackups, n)); };

async function pesquisaComItens(titulo, precosPorItem) {
  const p = (await chamar('POST', '/api/pesquisas', { titulo, processo: '45/2026', orgao: 'Prefeitura de Teste', responsavel: 'Maria Souza' })).corpo;
  const itens = [];
  for (const [i, precos] of precosPorItem.entries()) {
    const it = (await chamar('POST', `/api/pesquisas/${p.id}/itens`, { descricao: `Item ${i + 1} de ${titulo}`, quantidade: 2, unidade: 'UN' })).corpo;
    if (precos.length) await chamar('POST', `/api/itens/${it.id}/amostras`, { amostras: precos.map((preco, j) => ({ origem: 'compras.gov.br', chaveOrigem: `c${j}`, precoUnitario: preco, dataCompra: '2026-08-13', uf: 'MS', orgao: `Órgão ${j + 1}`, fornecedorNome: `Fornecedor ${j + 1}` })) });
    itens.push(it.id);
  }
  return { id: p.id, itens };
}

test('o servidor cria a pasta de dados sozinho e responde /api/saude', async () => {
  assert.ok(existsSync(process.env.DB_PATH));
  const r = await chamar('GET', '/api/saude');
  assert.deepEqual(r.corpo, { app: 'banco-de-precos-ls', ok: true });
});

test('exportar CSV: bytes exatos do início (BOM + cabeçalho) e backup criado antes', async () => {
  limparBackups();
  const { id } = await pesquisaComItens('CSV', [[6.2, 6.5, 6.8]]);
  const res = await fetch(`${base}/api/pesquisas/${id}/csv`);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.match(res.headers.get('content-type'), /text\/csv; charset=utf-8/);
  const inicio = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Item;Descrição;Quantidade;Unidade;Registro;Data;', 'utf8')]);
  assert.deepEqual(bytes.subarray(0, inicio.length), inicio);
  assert.deepEqual([...bytes.subarray(-2)], [0x0D, 0x0A]);
  const texto = bytes.toString('utf8');
  assert.ok(texto.includes(';6,20;Sim;'), 'preço com vírgula e duas casas');
  assert.ok(texto.includes(';RESUMO;'));

  const feitos = backups();
  assert.equal(feitos.length, 1, 'um backup antes da exportação');
  assert.match(feitos[0], /^pesquisa-precos-\d{8}-\d{6}\.db$/);
  const copia = new DatabaseSync(join(dirBackups, feitos[0]), { readOnly: true });
  assert.equal(copia.prepare('SELECT titulo FROM pesquisas WHERE id = ?').get(id).titulo, 'CSV');
  assert.equal(copia.prepare('SELECT COUNT(*) n FROM amostras').get().n >= 3, true);
  copia.close();

  await fetch(`${base}/api/pesquisas/${id}/csv`);
  await chamar('GET', `/api/pesquisas/${id}/mapa`);
  assert.equal(backups().length, 1, 'no mesmo minuto não gera outro');
});

test('mapa de preços: HTML para impressão com tabela, gráfico SVG, declaração e anexos; CSP sem inline', async () => {
  limparBackups();
  const { id, itens } = await pesquisaComItens('Mapa <script>alert(1)</script>', [[6.2, 6.5, 6.8, 7, 25], [10, 12]]);
  await chamar('PUT', `/api/itens/${itens[0]}`, { metodo: 'mediana', criterio: { tipo: 'iqr', k: 1.5 } });
  const item2 = (await chamar('GET', `/api/itens/${itens[1]}`)).corpo;
  await chamar('PUT', `/api/amostras/${item2.amostras[1].id}`, { manual: false, justificativa: 'Especificação divergente do termo de referência' });

  const r = await chamar('GET', `/api/pesquisas/${id}/mapa`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const csp = r.headers.get('content-security-policy');
  const nonce = /style-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce, 'CSP com nonce só para o <style> das margens');
  assert.ok(!csp.includes('unsafe-inline'));
  const html = r.corpo;
  assert.ok(html.includes(`<style nonce="${nonce}">@page{`));
  assert.ok(!/\sstyle="/.test(html), 'nenhum style="" embutido (a CSP bloquearia)');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'título escapado');
  assert.ok(html.includes('Mapa &lt;script&gt;alert(1)&lt;/script&gt;'));

  for (const trecho of ['Mapa de apuração de preços', 'Quadro-resumo', 'Desvio padrão', 'Mediana', 'Preço recomendado', 'Lei nº 14.133/2021', 'IN SEGES/ME nº 65/2021', 'art. 23', 'Maria Souza', 'Processo 45/2026', 'Anexo I', 'Anexo II', 'Amostras desconsideradas e motivos', 'counter(page)']) {
    assert.ok(html.includes(trecho), `falta "${trecho}"`);
  }
  assert.equal((html.match(/<svg class="grafico"/g) || []).length, 2, 'um gráfico por item');
  assert.match(html, /R\$\s6,65/, 'mediana das 4 válidas do item 1');
  assert.ok(html.includes('excessivamente elevado: acima do limite (amplitude interquartil (1,5 × IQR))'));
  assert.ok(html.includes('Justificativa: Especificação divergente do termo de referência'));
  assert.ok(html.includes('menos de 3 preços válidos'), 'item 2 ficou com 1 preço válido');
  assert.equal(backups().length, 1, 'backup antes de gerar o mapa');
});

test('exclusão em lote: backup obrigatório antes, só itens da própria pesquisa, e o backup guarda o que foi apagado', async () => {
  limparBackups();
  const a = await pesquisaComItens('Lote A', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  const b = await pesquisaComItens('Lote B', [[1]]);

  assert.equal((await chamar('POST', `/api/pesquisas/${a.id}/itens/excluir-lote`, { ids: [] })).status, 400);
  assert.equal((await chamar('POST', `/api/pesquisas/${a.id}/itens/excluir-lote`, { ids: ['x'] })).status, 400);
  const alheio = await chamar('POST', `/api/pesquisas/${a.id}/itens/excluir-lote`, { ids: [a.itens[0], b.itens[0]] });
  assert.equal(alheio.status, 400);
  assert.equal((await chamar('GET', `/api/pesquisas/${a.id}`)).corpo.itens.length, 3, 'pedido inválido não apaga nada');
  assert.equal(backups().length, 0, 'nem gera backup');

  const r = await chamar('POST', `/api/pesquisas/${a.id}/itens/excluir-lote`, { ids: [a.itens[0], a.itens[2], a.itens[0]] });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.excluidos, 2);
  assert.deepEqual(r.corpo.pesquisa.itens.map((i) => i.id), [a.itens[1]]);
  assert.match(r.corpo.backup, /^pesquisa-precos-\d{8}-\d{6}\.db$/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM amostras WHERE item_id IN (?, ?)').get(a.itens[0], a.itens[2]).n, 0, 'amostras dos itens vão junto');

  const copia = new DatabaseSync(join(dirBackups, r.corpo.backup), { readOnly: true });
  assert.equal(copia.prepare('SELECT COUNT(*) n FROM itens WHERE pesquisa_id = ?').get(a.id).n, 3, 'o backup é de antes da exclusão');
  assert.equal(copia.prepare('SELECT COUNT(*) n FROM amostras WHERE item_id = ?').get(a.itens[0]).n, 3);
  copia.close();
  assert.equal((await chamar('GET', `/api/pesquisas/${b.id}`)).corpo.itens.length, 1, 'a outra pesquisa fica intacta');
});

test('excluir pesquisa também faz backup antes', async () => {
  limparBackups();
  const { id } = await pesquisaComItens('Descartável', [[1, 2, 3]]);
  assert.equal((await chamar('DELETE', `/api/pesquisas/${id}`)).status, 200);
  assert.equal(backups().length, 1);
  assert.equal((await chamar('DELETE', '/api/pesquisas/999999')).status, 404);
});

test('retenção configurada (BACKUP_RETENCAO=5) e status em /api/backups', async () => {
  limparBackups();
  const { criarBackup } = await import('../server/backup.mjs');
  const t0 = Date.now() - 20 * 60_000;
  for (let i = 0; i < 8; i++) criarBackup(db, process.env.DB_PATH, { agora: new Date(t0 + i * 61_000), retencao: 5 });
  assert.equal(backups().length, 5);
  const st = (await chamar('GET', '/api/backups')).corpo;
  assert.equal(st.retencao, 5);
  assert.equal(st.total, 5);
  assert.match(st.ultimo.nome, /^pesquisa-precos-/);
  assert.ok(st.ultimo.bytes > 0);
});

test('justificativa por amostra: auditável (trilha) e reversível', async () => {
  const { itens } = await pesquisaComItens('Auditoria', [[10, 11, 12, 13]]);
  const iid = itens[0];
  let it = (await chamar('GET', `/api/itens/${iid}`)).corpo;
  const alvo = it.amostras[3];

  assert.equal((await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: false })).status, 400);
  it = (await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: false, justificativa: 'Embalagem diferente' })).corpo;
  let a = it.amostras.find((x) => x.id === alvo.id);
  assert.deepEqual([a.incluida, a.motivo, a.justificativa], [false, 'excluída manualmente', 'Embalagem diferente']);
  assert.equal(it.estimativa.resumo.n, 3);

  it = (await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: null })).corpo;
  a = it.amostras.find((x) => x.id === alvo.id);
  assert.deepEqual([a.incluida, a.motivo, a.justificativa], [true, null, null], 'reverter limpa a justificativa vigente');
  assert.equal(it.estimativa.resumo.n, 4);

  // exclusão automática também pode receber justificativa complementar
  it = (await chamar('PUT', `/api/itens/${iid}`, { criterio: { tipo: 'desvio', k: 1 } })).corpo;
  const auto = it.amostras.find((x) => !x.incluida);
  assert.ok(auto, 'o critério excluiu ao menos uma');
  it = (await chamar('PUT', `/api/amostras/${auto.id}`, { justificativa: 'Confirmado: preço de lote promocional' })).corpo;
  assert.equal(it.amostras.find((x) => x.id === auto.id).justificativa, 'Confirmado: preço de lote promocional');
  await chamar('DELETE', `/api/amostras/${auto.id}`);

  const trilha = (await chamar('GET', `/api/itens/${iid}/historico`)).corpo;
  assert.deepEqual(trilha.map((d) => d.acao), ['remover', 'justificar', 'criterio', 'desconsiderar']);
  assert.equal(trilha[3].justificativa, 'Embalagem diferente', 'a justificativa original segue na trilha');
  assert.equal(trilha[3].preco_unitario, 13);
  assert.equal(trilha[3].usuario, 'local');
  assert.match(trilha[3].em, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('preço recomendado segue o critério escolhido e a API devolve as três opções e os limites', async () => {
  const { itens } = await pesquisaComItens('Recomendado', [[10, 12, 17, 90]]);
  const esperado = { media: 13, mediana: 12, menor: 10 };
  for (const metodo of ['media', 'mediana', 'menor']) {
    const it = (await chamar('PUT', `/api/itens/${itens[0]}`, { metodo, criterio: { tipo: 'mediana', inferior: 0.5, superior: 0.5 } })).corpo;
    assert.equal(it.estimativa.valor, esperado[metodo]);
    assert.deepEqual(it.estimativa.opcoes, esperado);
    assert.equal(it.total, esperado[metodo] * 2);
    assert.equal(it.limites.aplicavel, true);
    assert.equal(it.estimativa.insuficiente, false);
  }
  assert.equal((await chamar('PUT', `/api/itens/${itens[0]}`, { criterio: { tipo: 'iqr', k: 0 } })).status, 400, 'k precisa ser positivo');
  const limpo = (await chamar('PUT', `/api/itens/${itens[0]}`, { criterio: { tipo: 'iqr', k: 1.5, inferior: 0.2, lixo: 'x' } })).corpo;
  assert.deepEqual(limpo.criterio, { tipo: 'iqr', k: 1.5 }, 'só as chaves do critério são gravadas');
});

test('padrões da pesquisa (definidos no assistente) valem para os itens novos', async () => {
  const p = (await chamar('POST', '/api/pesquisas', { titulo: 'Com padrões', metodoPadrao: 'mediana', criterioPadrao: { tipo: 'iqr', k: 1.5 } })).corpo;
  assert.equal(p.metodo_padrao, 'mediana');
  assert.deepEqual(p.criterio_padrao, { tipo: 'iqr', k: 1.5 });
  const it = (await chamar('POST', `/api/pesquisas/${p.id}/itens`, { descricao: 'Herdeiro', quantidade: 1 })).corpo;
  assert.equal(it.metodo, 'mediana');
  assert.deepEqual(it.criterio, { tipo: 'iqr', k: 1.5 });
  const proprio = (await chamar('POST', `/api/pesquisas/${p.id}/itens`, { descricao: 'Próprio', quantidade: 1, metodo: 'menor' })).corpo;
  assert.equal(proprio.metodo, 'menor');
  assert.equal((await chamar('POST', '/api/pesquisas', { titulo: 'x', metodoPadrao: 'chute' })).status, 400);
  const lista = (await chamar('GET', '/api/pesquisas')).corpo;
  const naLista = lista.find((x) => x.id === p.id);
  assert.deepEqual([naLista.total_itens, naLista.total_amostras, naLista.itens_insuficientes], [2, 0, 2]);
});

test('fontes woff2 são servidas com tipo e cache corretos', async () => {
  const css = await chamar('GET', '/fontes.css');
  assert.equal(css.status, 200);
  const arquivos = [...css.corpo.matchAll(/url\("?([^")]+\.woff2)"?\)/g)].map((m) => m[1]);
  assert.ok(arquivos.length >= 6, 'há fontes declaradas');
  for (const arq of new Set(arquivos)) {
    const r = await fetch(`${base}/${arq.replace(/^\.?\//, '')}`);
    assert.equal(r.status, 200, arq);
    assert.equal(r.headers.get('content-type'), 'font/woff2');
    assert.match(r.headers.get('cache-control'), /immutable/);
    const b = Buffer.from(await r.arrayBuffer());
    assert.equal(b.subarray(0, 4).toString('latin1'), 'wOF2', `${arq} é woff2 de verdade`);
  }
});

test('banco da versão anterior é migrado sem perder dados', async () => {
  const { abrirBanco } = await import('../server/db.mjs');
  const antigo = join(pasta, 'antigo.db');
  const bruto = new DatabaseSync(antigo);
  bruto.exec(`CREATE TABLE pesquisas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, processo TEXT, orgao TEXT, responsavel TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO pesquisas (titulo, processo) VALUES ('Pesquisa de 2025', '9/2025');`);
  bruto.close();
  const migrado = abrirBanco(antigo);
  const linha = migrado.prepare('SELECT * FROM pesquisas').get();
  assert.equal(linha.titulo, 'Pesquisa de 2025');
  assert.equal(linha.metodo_padrao, 'auto');
  assert.equal(linha.criterio_padrao, '{"tipo":"nenhum"}');
  migrado.close();
  abrirBanco(antigo).close(); // abrir de novo não tenta recriar as colunas
});
