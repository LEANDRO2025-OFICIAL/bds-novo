// Resiliência do cliente HTTP (Compras.gov.br e PNCP) contra um servidor falso de verdade (node:http)
// que falha N vezes: novas tentativas com backoff + jitter, timeout por tentativa, 429/5xx × 4xx e reserva em cache.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { obterJson, consultarPrecos, esperaBackoff, lerRetryAfter, statusRepetivel, criarRastro, limparCacheAntigo, criarFila, ErroApi } from '../server/compras.mjs';
import { consultarPrecosPncp } from '../server/pncp.mjs';
import { abrirBanco } from '../server/db.mjs';

let servidor;
let base;
/** Roteiro por caminho: lista de respostas consumidas em ordem; a última se repete. */
const roteiro = new Map();
const pedidos = [];
const penduradas = new Set();

before(async () => {
  servidor = createServer((req, res) => {
    const caminho = new URL(req.url, 'http://x').pathname;
    pedidos.push(caminho);
    const fila = roteiro.get(caminho) || [{ status: 404, corpo: { detail: 'sem roteiro' } }];
    const r = fila.length > 1 ? fila.shift() : fila[0];
    if (r.pendurar) { penduradas.add(res); return; } // nunca responde: força o timeout do cliente
    res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers || {}) });
    res.end(r.texto ?? (r.corpo === undefined ? '' : JSON.stringify(r.corpo)));
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { for (const r of penduradas) r.destroy(); servidor.closeAllConnections?.(); servidor.close(); });
beforeEach(() => { roteiro.clear(); pedidos.length = 0; });

const falha = (status, extra = {}) => ({ status, corpo: { detail: `erro ${status}` }, ...extra });
const ok = (corpo) => ({ status: 200, corpo });
/** Opções rápidas e determinísticas: registra as esperas em vez de dormir de verdade. */
const rapido = (extra = {}) => {
  const esperas = [];
  return { esperas, opcoes: { fila: criarFila(4), baseMs: 100, tetoMs: 5000, aleatorio: () => 0.5, dormirImpl: async (ms) => { esperas.push(ms); }, ...extra } };
};

describe('backoff exponencial com jitter', () => {
  test('dobra a cada tentativa, respeita o teto e fica entre metade e o valor cheio', () => {
    const o = { baseMs: 800, tetoMs: 20_000 };
    assert.equal(esperaBackoff(1, { ...o, aleatorio: () => 0 }), 400);
    assert.equal(esperaBackoff(1, { ...o, aleatorio: () => 1 }), 800);
    assert.equal(esperaBackoff(2, { ...o, aleatorio: () => 1 }), 1600);
    assert.equal(esperaBackoff(3, { ...o, aleatorio: () => 1 }), 3200);
    assert.equal(esperaBackoff(10, { ...o, aleatorio: () => 1 }), 20_000);
    const amostras = Array.from({ length: 200 }, () => esperaBackoff(3, o));
    assert.ok(amostras.every((x) => x >= 1600 && x <= 3200));
    assert.ok(new Set(amostras).size > 20, 'o jitter espalha as esperas');
  });
  test('Retry-After em segundos ou data HTTP; vale como piso até o teto', () => {
    assert.equal(lerRetryAfter('3'), 3000);
    assert.equal(lerRetryAfter(null), null);
    assert.equal(lerRetryAfter('abc'), null);
    assert.equal(lerRetryAfter('Wed, 11 Nov 2026 10:00:05 GMT', Date.parse('2026-11-11T10:00:00Z')), 5000);
    assert.equal(esperaBackoff(1, { baseMs: 100, tetoMs: 5000, aleatorio: () => 1, retryAfterMs: 2000 }), 2000);
    assert.equal(esperaBackoff(1, { baseMs: 100, tetoMs: 5000, aleatorio: () => 1, retryAfterMs: 60_000 }), 5000);
  });
  test('só 408, 425, 429 e 5xx são repetíveis', () => {
    assert.deepEqual([400, 401, 403, 404, 422].map(statusRepetivel), [false, false, false, false, false]);
    assert.deepEqual([408, 425, 429, 500, 502, 503, 504].map(statusRepetivel), [true, true, true, true, true, true, true]);
  });
});

describe('servidor falso que falha N vezes', () => {
  test('503 três vezes e depois 200: conclui na 4ª tentativa com esperas crescentes', async () => {
    roteiro.set('/instavel', [falha(503), falha(502), falha(500), ok({ valor: 42 })]);
    const { esperas, opcoes } = rapido();
    assert.deepEqual(await obterJson(null, `${base}/instavel`, opcoes), { valor: 42 });
    assert.equal(pedidos.length, 4);
    assert.deepEqual(esperas, [75, 150, 300], 'metade fixa + metade × 0,5 de 100, 200 e 400 ms');
  });

  test('falha mais vezes que o limite: desiste com erro que cita a fonte e o status', async () => {
    roteiro.set('/fora', [falha(503)]);
    const { esperas, opcoes } = rapido({ tentativas: 3, fonte: 'PNCP' });
    await assert.rejects(obterJson(null, `${base}/fora`, opcoes), (e) => e instanceof ErroApi && e.status === 503 && /PNCP respondeu 503/.test(e.message) && e.tentativas === 3);
    assert.equal(pedidos.length, 3);
    assert.equal(esperas.length, 2, 'não espera depois da última tentativa');
  });

  test('429 com Retry-After: espera o que o servidor pediu e tenta de novo', async () => {
    roteiro.set('/limite', [falha(429, { headers: { 'retry-after': '2' } }), ok({ ok: true })]);
    const { esperas, opcoes } = rapido();
    assert.deepEqual(await obterJson(null, `${base}/limite`, opcoes), { ok: true });
    assert.deepEqual(esperas, [2000]);
  });

  test('4xx (400, 401, 403, 404, 422) não é repetido', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      pedidos.length = 0;
      roteiro.set('/pedido-ruim', [falha(status), ok({ nunca: true })]);
      const { esperas, opcoes } = rapido();
      await assert.rejects(obterJson(null, `${base}/pedido-ruim`, opcoes), (e) => e.status === status && new RegExp(`erro ${status}`).test(e.message));
      assert.equal(pedidos.length, 1, `status ${status}`);
      assert.equal(esperas.length, 0);
    }
  });

  test('timeout por tentativa: pedido pendurado é abortado e a tentativa seguinte conclui', async () => {
    roteiro.set('/lento', [{ pendurar: true }, { pendurar: true }, ok({ chegou: true })]);
    const { opcoes } = rapido({ timeoutMs: 120 });
    const inicio = Date.now();
    assert.deepEqual(await obterJson(null, `${base}/lento`, opcoes), { chegou: true });
    assert.equal(pedidos.length, 3);
    const duracao = Date.now() - inicio;
    assert.ok(duracao >= 230 && duracao < 3000, `2 timeouts de 120 ms, levou ${duracao} ms`);
  });

  test('timeout em todas as tentativas vira erro de tempo esgotado', async () => {
    roteiro.set('/morto', [{ pendurar: true }]);
    const { opcoes } = rapido({ timeoutMs: 60, tentativas: 2 });
    await assert.rejects(obterJson(null, `${base}/morto`, opcoes), /Tempo esgotado \(0,1 s\) ao consultar Compras\.gov\.br/);
    assert.equal(pedidos.length, 2);
  });

  test('conexão recusada (servidor desligado) é repetida e vira falha de rede', async () => {
    const morto = createServer();
    await new Promise((r) => morto.listen(0, '127.0.0.1', r));
    const porta = morto.address().port;
    await new Promise((r) => morto.close(r));
    const { esperas, opcoes } = rapido({ tentativas: 3 });
    await assert.rejects(obterJson(null, `http://127.0.0.1:${porta}/x`, opcoes), /Falha de rede \(Compras\.gov\.br\): ECONNREFUSED/);
    assert.equal(esperas.length, 2);
  });

  test('200 com corpo ilegível (página de erro de proxy) é repetido', async () => {
    roteiro.set('/html', [{ status: 200, texto: '<html>Bad gateway</html>' }, ok({ certo: 1 })]);
    const { opcoes } = rapido();
    assert.deepEqual(await obterJson(null, `${base}/html`, opcoes), { certo: 1 });
    assert.equal(pedidos.length, 2);
  });

  test('204 sem corpo vira null', async () => {
    roteiro.set('/vazio', [{ status: 204 }]);
    assert.equal(await obterJson(null, `${base}/vazio`, rapido().opcoes), null);
  });
});

describe('reserva no cache local (SQLite)', () => {
  const envelhecer = (db, horas) => db.prepare('UPDATE cache SET criado_em = criado_em - ?').run(horas * 3600 * 1000);

  test('cache válido responde sem rede e o rastro registra a data', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/dados', [ok({ v: 1 })]);
    const r1 = criarRastro();
    await obterJson(db, `${base}/dados`, { ...rapido().opcoes, rastro: r1 });
    assert.deepEqual(r1.resumo(), { usado: false, total: false, obsoleto: false, de: null, motivo: null });
    const r2 = criarRastro();
    assert.deepEqual(await obterJson(db, `${base}/dados`, { ...rapido().opcoes, rastro: r2 }), { v: 1 });
    assert.equal(pedidos.length, 1, 'segunda chamada não foi à rede');
    const resumo = r2.resumo();
    assert.equal(resumo.usado, true);
    assert.equal(resumo.total, true);
    assert.equal(resumo.obsoleto, false);
    assert.ok(Date.now() - Date.parse(resumo.de) < 5000);
  });

  test('fonte fora do ar + cache vencido: devolve o guardado e marca como obsoleto, com a data original', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/precos', [ok({ v: 'antigo' }), falha(503)]);
    await obterJson(db, `${base}/precos`, rapido().opcoes);
    envelhecer(db, 72);
    const guardadoEm = db.prepare('SELECT criado_em FROM cache').get().criado_em;
    const rastro = criarRastro();
    const { opcoes } = rapido({ tentativas: 3, rastro });
    assert.deepEqual(await obterJson(db, `${base}/precos`, opcoes), { v: 'antigo' });
    assert.equal(pedidos.length, 1 + 3, 'tentou a rede 3 vezes antes de recorrer ao cache');
    const resumo = rastro.resumo();
    assert.equal(resumo.obsoleto, true);
    assert.equal(resumo.de, new Date(guardadoEm).toISOString());
    assert.match(resumo.motivo, /respondeu 503/);
    assert.equal(db.prepare('SELECT criado_em FROM cache').get().criado_em, guardadoEm, 'a data do cache não é renovada pela falha');
  });

  test('cache vencido + fonte de volta: busca na rede e renova o cache', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/renova', [ok({ v: 1 }), ok({ v: 2 })]);
    await obterJson(db, `${base}/renova`, rapido().opcoes);
    envelhecer(db, 25);
    assert.deepEqual(await obterJson(db, `${base}/renova`, rapido().opcoes), { v: 2 });
    assert.equal(JSON.parse(db.prepare('SELECT corpo FROM cache').get().corpo).v, 2);
  });

  test('semCache força a rede; se ela falhar, ainda recorre ao guardado', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/forcar', [ok({ v: 1 }), ok({ v: 2 }), falha(500)]);
    await obterJson(db, `${base}/forcar`, rapido().opcoes);
    assert.deepEqual(await obterJson(db, `${base}/forcar`, { ...rapido().opcoes, semCache: true }), { v: 2 });
    const rastro = criarRastro();
    assert.deepEqual(await obterJson(db, `${base}/forcar`, { ...rapido({ tentativas: 2 }).opcoes, semCache: true, rastro }), { v: 2 });
    assert.equal(rastro.resumo().obsoleto, true);
  });

  test('erro do pedido (4xx) não é mascarado pelo cache', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/mudou', [ok({ v: 1 }), falha(400)]);
    await obterJson(db, `${base}/mudou`, rapido().opcoes);
    envelhecer(db, 48);
    await assert.rejects(obterJson(db, `${base}/mudou`, rapido().opcoes), (e) => e.status === 400);
  });

  test('sem cache e fonte fora do ar: erro', async () => {
    const db = abrirBanco(':memory:');
    roteiro.set('/nada', [falha(503)]);
    await assert.rejects(obterJson(db, `${base}/nada`, rapido({ tentativas: 2 }).opcoes), ErroApi);
  });

  test('limpeza apaga só o que passou da retenção', async () => {
    const db = abrirBanco(':memory:');
    const ins = db.prepare('INSERT INTO cache (chave, corpo, criado_em) VALUES (?, ?, ?)');
    ins.run('novo', '{}', Date.now() - 2 * 86400e3);
    ins.run('velho', '{}', Date.now() - 31 * 86400e3);
    assert.equal(limparCacheAntigo(db, 30), 1);
    assert.deepEqual(db.prepare('SELECT chave FROM cache').all().map((x) => x.chave), ['novo']);
  });
});

describe('consultas completas contra o servidor falso', () => {
  // As consultas montam URLs absolutas dos portais; o fetch abaixo só troca a origem pela do servidor falso.
  const viaFalso = (url, init) => { const u = new URL(url); return fetch(base + u.pathname + u.search, init); };
  const REG = { idCompra: 1, idCompraItem: 'a1', dataCompra: '2026-08-13', precoUnitario: 6.2, descricaoItem: 'TINTA', estado: 'MS', niFornecedor: '1' };

  test('Compras.gov.br: falha 2 vezes, responde, e depois sobrevive à queda usando o cache', async () => {
    const db = abrirBanco(':memory:');
    const caminho = '/modulo-pesquisa-preco/1_consultarMaterial';
    roteiro.set(caminho, [falha(503), falha(429, { headers: { 'retry-after': '0' } }), ok({ resultado: [REG], totalRegistros: 1, paginasRestantes: 0 }), falha(503)]);
    const filtros = { tipo: 'material', codigoTipo: 'pdm', codigo: 284, inicio: '2025-11-11', fim: '2026-11-11' };
    const r1 = await consultarPrecos(db, filtros, { ...rapido().opcoes, fetchImpl: viaFalso });
    assert.equal(r1.registros.length, 1);
    assert.equal(r1.cache.usado, false);
    assert.equal(pedidos.length, 3);

    const r2 = await consultarPrecos(db, filtros, { ...rapido().opcoes, fetchImpl: viaFalso });
    assert.equal(pedidos.length, 3, 'dentro de 24 h responde do cache');
    assert.deepEqual([r2.cache.usado, r2.cache.total, r2.cache.obsoleto], [true, true, false]);

    db.prepare('UPDATE cache SET criado_em = ?').run(Date.parse('2026-11-05T12:00:00Z'));
    const r3 = await consultarPrecos(db, filtros, { ...rapido({ tentativas: 2 }).opcoes, fetchImpl: viaFalso });
    assert.equal(r3.registros.length, 1, 'fonte fora do ar: resultado vem do cache vencido');
    assert.deepEqual([r3.cache.usado, r3.cache.obsoleto, r3.cache.de], [true, true, '2026-11-05T12:00:00.000Z']);
    assert.match(r3.cache.motivo, /respondeu 503/);
  });

  test('PNCP: busca falha 1 vez, itens falham 2 vezes, resultado chega; rastro acusa cache na repetição', async () => {
    const db = abrirBanco(':memory:');
    const c = { numero_controle_pncp: 'x-1', orgao_cnpj: '03563335000106', orgao_nome: 'MUNICIPIO', ano: '2026', numero_sequencial: '63', uf: 'MS', tem_resultado: true, cancelado: false, data_publicacao_pncp: '2026-10-15T11:09:01' };
    const itens = '/api/pncp/v1/orgaos/03563335000106/compras/2026/63/itens';
    roteiro.set('/api/search/', [falha(502), ok({ items: [c] })]);
    roteiro.set(itens, [falha(503), falha(503), ok([{ numeroItem: 2, descricao: 'IMPRESSORA JATO DE TINTA', temResultado: true, unidadeMedida: 'UN' }])]);
    roteiro.set(`${itens}/2/resultados`, [ok([{ valorUnitarioHomologado: 4018.89, dataResultado: '2026-10-14', sequencialResultado: 1, niFornecedor: '5' }])]);
    // dados da contratação (portal de origem): uma chamada a mais, só quando há preço aproveitável
    roteiro.set('/api/consulta/v1/orgaos/03563335000106/compras/2026/63', [ok({ linkSistemaOrigem: 'https://www.licitanet.com.br/p/1', usuarioNome: 'Licitanet' })]);
    const filtros = { palavras: 'impressora', inicio: '2025-11-11', fim: '2026-11-11' };
    const r = await consultarPrecosPncp(db, filtros, { ...rapido().opcoes, fetchImpl: viaFalso });
    assert.equal(r.registros.length, 1);
    assert.equal(r.registros[0].precoUnitario, 4018.89);
    assert.equal(r.registros[0].portalOrigem, 'licitanet');
    assert.equal(pedidos.length, 2 + 3 + 1 + 1);
    assert.equal(r.cache.usado, false);

    const de = await consultarPrecosPncp(db, filtros, { ...rapido().opcoes, fetchImpl: viaFalso });
    assert.equal(pedidos.length, 7);
    assert.equal(de.cache.total, true);

    // fonte cai e o cache vence: a consulta inteira ainda responde, marcada como obsoleta
    db.prepare('UPDATE cache SET criado_em = criado_em - ?').run(30 * 3600 * 1000);
    roteiro.set('/api/search/', [falha(503)]);
    roteiro.set(itens, [falha(503)]);
    roteiro.set(`${itens}/2/resultados`, [falha(503)]);
    const queda = await consultarPrecosPncp(db, filtros, { ...rapido({ tentativas: 2 }).opcoes, fetchImpl: viaFalso });
    assert.equal(queda.registros.length, 1);
    assert.equal(queda.registros[0].portalOrigem, 'licitanet', 'portal de origem também vem do cache vencido');
    assert.equal(queda.cache.obsoleto, true);
    assert.match(queda.cache.motivo, /PNCP respondeu 503/);
  });
});
