// Login ligado (USUARIOS definido): API fechada sem sessão, cookie seguro, bloqueio por tentativas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { carregarUsuarios } from '../server/auth.mjs';

process.env.DB_PATH = ':memory:';
process.env.USUARIOS = 'Ana:senha-forte-1;bruno:outra:senha2';
const { servidor } = await import('../server/server.mjs');

let base;
before(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const chamar = (metodo, caminho, { corpo, cookie, ip } = {}) => fetch(base + caminho, {
  method: metodo,
  headers: { ...(corpo ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(ip ? { 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' } : {}) },
  body: corpo ? JSON.stringify(corpo) : undefined,
});

test('sem sessão: dados bloqueados, página e /api/sessao livres', async () => {
  assert.equal((await chamar('GET', '/api/pesquisas')).status, 401);
  assert.equal((await chamar('POST', '/api/pesquisas', { corpo: { titulo: 'x' } })).status, 401);
  assert.equal((await chamar('GET', '/')).status, 200);
  assert.deepEqual(await (await chamar('GET', '/api/sessao')).json(), { exigeLogin: true, usuario: null });
});

test('login certo abre a API; logout fecha', async () => {
  assert.equal((await chamar('POST', '/api/login', { corpo: { usuario: 'ana', senha: 'errada123' }, ip: '9.9.9.1' })).status, 401);
  const r = await chamar('POST', '/api/login', { corpo: { usuario: ' ANA ', senha: 'senha-forte-1' }, ip: '9.9.9.1' });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/, 'atrás de https o cookie é Secure');
  const cookie = setCookie.split(';')[0];
  assert.equal((await chamar('GET', '/api/pesquisas', { cookie })).status, 200);
  assert.equal((await (await chamar('GET', '/api/sessao', { cookie })).json()).usuario, 'ana');
  await chamar('POST', '/api/logout', { cookie });
  assert.equal((await chamar('GET', '/api/pesquisas', { cookie })).status, 401);
  assert.equal((await chamar('GET', '/api/pesquisas', { cookie: 'sessao=inventado' })).status, 401);
});

test('senha com ":" funciona', async () => {
  assert.equal((await chamar('POST', '/api/login', { corpo: { usuario: 'bruno', senha: 'outra:senha2' }, ip: '9.9.9.2' })).status, 200);
});

test('10 erros bloqueiam o IP, mesmo com a senha certa depois', async () => {
  for (let i = 0; i < 10; i++) await chamar('POST', '/api/login', { corpo: { usuario: 'ana', senha: 'x' }, ip: '9.9.9.3' });
  assert.equal((await chamar('POST', '/api/login', { corpo: { usuario: 'ana', senha: 'senha-forte-1' }, ip: '9.9.9.3' })).status, 429);
  // IP forjado no início do x-forwarded-for não escapa: vale o último (posto pelo proxy)
  assert.equal((await chamar('POST', '/api/login', { corpo: { usuario: 'ana', senha: 'senha-forte-1' }, ip: '1.2.3.4, 9.9.9.3' })).status, 429);
});

test('senha curta é recusada na configuração', () => {
  assert.throws(() => carregarUsuarios('ze:1234567'), /8 caracteres/);
});
