// Integração HTTP com banco em memória (sem rede externa).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { servidor, linkSeguro } = await import('../server/server.mjs');

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

test('fluxo completo: pesquisa → item → amostras → análise → CSV', async () => {
  const p = await chamar('POST', '/api/pesquisas', { titulo: 'Material de expediente', processo: '123/2026', orgao: 'Prefeitura Teste' });
  assert.equal(p.status, 200);
  const it = await chamar('POST', `/api/pesquisas/${p.corpo.id}/itens`, { descricao: 'Tinta para impressora', quantidade: 10, unidade: 'UN' });
  assert.equal(it.status, 200);
  const iid = it.corpo.id;

  const amostras = [6.2, 6.5, 6.8, 7.0, 25].map((preco, i) => ({ origem: 'compras.gov.br', chaveOrigem: `k${i}`, precoUnitario: preco, dataCompra: '2026-08-13', uf: 'MS' }));
  const add = await chamar('POST', `/api/itens/${iid}/amostras`, { amostras });
  assert.equal(add.corpo.inseridas, 5);
  const repetida = await chamar('POST', `/api/itens/${iid}/amostras`, { amostras: amostras.slice(0, 2) });
  assert.equal(repetida.corpo.ignoradas, 2, 'mesma amostra não duplica');

  const cfg = await chamar('PUT', `/api/itens/${iid}`, { metodo: 'media', criterio: { tipo: 'desvio', k: 1 } });
  assert.equal(cfg.corpo.estimativa.resumo.n, 4, 'o 25,00 sai pelo critério');
  assert.equal(cfg.corpo.estimativa.valor, 6.63);
  assert.equal(cfg.corpo.total, 66.3);

  const alvo = cfg.corpo.amostras.find((a) => a.preco_unitario === 6.2);
  const semJust = await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: false });
  assert.equal(semJust.status, 400, 'exclusão manual exige justificativa');
  const comJust = await chamar('PUT', `/api/amostras/${alvo.id}`, { manual: false, justificativa: 'Marca incompatível com o especificado' });
  assert.equal(comJust.corpo.estimativa.resumo.n, 3);

  const pesq = await chamar('GET', `/api/pesquisas/${p.corpo.id}`);
  assert.equal(pesq.corpo.totalGeral, comJust.corpo.total);

  const csv = await chamar('GET', `/api/pesquisas/${p.corpo.id}/csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.ok(csv.corpo.includes('Marca incompatível'));
  assert.ok(csv.corpo.includes('6,77'), 'estimado após a exclusão manual');
});

test('validações devolvem 400 com mensagem', async () => {
  assert.equal((await chamar('POST', '/api/pesquisas', { titulo: '  ' })).status, 400);
  const p = await chamar('POST', '/api/pesquisas', { titulo: 'X' });
  assert.equal((await chamar('POST', `/api/pesquisas/${p.corpo.id}/itens`, { descricao: 'Y', quantidade: 0 })).status, 400);
  const it = await chamar('POST', `/api/pesquisas/${p.corpo.id}/itens`, { descricao: 'Y', quantidade: 1 });
  assert.equal((await chamar('PUT', `/api/itens/${it.corpo.id}`, { metodo: 'chute' })).status, 400);
  assert.equal((await chamar('POST', `/api/itens/${it.corpo.id}/amostras`, { amostras: [{ precoUnitario: -1 }] })).status, 400);
  assert.equal((await chamar('GET', '/api/precos?codigo=abc')).status, 400);
  // PNCP sem palavras-chave e com código fora do catálogo: não há termo para buscar
  assert.equal((await chamar('GET', '/api/precos?fonte=pncp&codigo=999999')).status, 400);
  assert.equal((await chamar('GET', '/api/precos?codigo=284&fonte=bds')).status, 400, 'fonte desconhecida');
  const semPalavras = await chamar('GET', '/api/precos?fonte=pncp&palavras=ab');
  assert.equal(semPalavras.status, 400, 'PNCP exige palavras-chave');
  assert.match(semPalavras.corpo.erro, /palavras-chave/);
  assert.equal((await chamar('GET', '/api/pesquisas/999999')).status, 404);
});

test('link de cotação só aceita http(s) — bloqueia javascript:', async () => {
  assert.equal(linkSeguro('javascript:alert(1)'), null);
  assert.equal(linkSeguro('data:text/html,x'), null);
  assert.equal(linkSeguro('https://loja.exemplo/p?id=1'), 'https://loja.exemplo/p?id=1');
  const p = await chamar('POST', '/api/pesquisas', { titulo: 'XSS' });
  const it = await chamar('POST', `/api/pesquisas/${p.corpo.id}/itens`, { descricao: 'Z', quantidade: 1 });
  const r = await chamar('POST', `/api/itens/${it.corpo.id}/amostras`, { amostras: [{ precoUnitario: 1, link: 'javascript:alert(1)' }] });
  assert.equal(r.corpo.item.amostras[0].link, null);
});

test('arquivos estáticos com CSP e proteção de path traversal', async () => {
  const idx = await chamar('GET', '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await chamar('GET', '/app.js')).status, 200);
  // '..' é travado na raiz pelo normalize: a tentativa vira public/package.json (inexistente) e nunca sai de public/
  for (const ataque of ['/..%2f..%2fpackage.json', '/..%5c..%5cserver%5cserver.mjs', '/%2e%2e/%2e%2e/package.json']) {
    const r = await chamar('GET', ataque);
    assert.equal(r.status, 404, ataque);
    assert.ok(!String(r.corpo).includes('"scripts"') && !String(r.corpo).includes('createServer'), `vazou conteúdo em ${ataque}`);
  }
  assert.equal((await chamar('GET', '/nao-existe.js')).status, 404);
  assert.equal((await chamar('GET', '/pesquisa/1')).status, 200, 'rota do front cai no index');
});
