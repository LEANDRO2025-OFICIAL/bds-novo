// Inicialização como o usuário faz (processo de verdade): cria data/, avisa porta ocupada de forma amigável,
// e o verificador de porta usado pelo INICIAR.cmd distingue livre / o próprio sistema / outro programa.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcp } from 'node:net';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarPorta, LIVRE, NOSSO, OUTRO } from '../server/verificar-porta.mjs';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pasta = mkdtempSync(join(tmpdir(), 'bp-inicio-'));
const filhos = [];
after(() => { for (const f of filhos) f.kill(); rmSync(pasta, { recursive: true, force: true }); });

const portaLivre = () => new Promise((ok) => { const s = createTcp(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

function iniciar(env) {
  const filho = spawn(process.execPath, [join(RAIZ, 'server', 'server.mjs')], { env: { ...process.env, USUARIOS: '', USUARIOS_ARQUIVO: '', HOST: '127.0.0.1', ABRIR_NAVEGADOR: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.push(filho);
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  const fim = new Promise((ok) => filho.on('exit', (codigo) => ok(codigo)));
  const pronto = new Promise((ok, falha) => {
    const t = setInterval(() => { if (/Banco de Preços LS em http/.test(saida)) { clearInterval(t); ok(); } }, 20);
    fim.then((c) => { clearInterval(t); falha(new Error(`saiu com ${c}: ${saida}`)); });
  });
  pronto.catch(() => {}); // quem espera decide; evita rejeição não tratada quando o processo sai de propósito
  return { filho, fim, pronto, saida: () => saida };
}

test('sobe criando data/ que não existia; segunda instância na mesma porta sai com aviso amigável', async () => {
  const porta = await portaLivre();
  const dbPath = join(pasta, 'nao', 'existe', 'ainda', 'pesquisa-precos.db');
  const a = iniciar({ PORT: String(porta), DB_PATH: dbPath });
  await a.pronto;
  assert.ok(existsSync(dbPath), 'pasta de dados e banco criados');
  assert.equal(await verificarPorta(porta), NOSSO);

  const b = iniciar({ PORT: String(porta), DB_PATH: join(pasta, 'outro', 'p.db') });
  const codigo = await b.fim;
  assert.equal(codigo, 1);
  assert.match(b.saida(), new RegExp(`A porta ${porta} já está em uso`));
  assert.match(b.saida(), /já está aberto em outra janela/);
  assert.ok(!/at .*server\.mjs|EADDRINUSE|node:net/.test(b.saida()), 'sem stack trace assustador');

  a.filho.kill();
  await a.fim;
  assert.equal(await verificarPorta(porta), LIVRE);
});

test('verificador de porta: outro programa HTTP, programa que não fala HTTP e versão antiga do sistema', async () => {
  const http = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>Outro sistema</h1>'); });
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  assert.equal(await verificarPorta(http.address().port), OUTRO);
  http.close();

  const mudo = createTcp(() => { /* aceita a conexão e nunca responde */ });
  await new Promise((r) => mudo.listen(0, '127.0.0.1', r));
  assert.equal(await verificarPorta(mudo.address().port, { ms: 300 }), OUTRO);
  mudo.close();

  const antigo = createServer((req, res) => {
    res.writeHead(req.url === '/api/sessao' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/sessao' ? { exigeLogin: false, usuario: null } : { erro: 'Rota não encontrada.' }));
  });
  await new Promise((r) => antigo.listen(0, '127.0.0.1', r));
  assert.equal(await verificarPorta(antigo.address().port), NOSSO, 'versão sem /api/saude ainda é reconhecida');
  antigo.close();
});

test('verificar-porta.mjs pela linha de comando devolve os códigos que o INICIAR.cmd espera', async () => {
  const rodar = (porta) => new Promise((ok) => spawn(process.execPath, [join(RAIZ, 'server', 'verificar-porta.mjs'), String(porta)]).on('exit', ok));
  const livre = await portaLivre();
  assert.equal(await rodar(livre), 0);
  const http = createServer((req, res) => res.end('x'));
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  assert.equal(await rodar(http.address().port), 20);
  http.close();
  assert.equal(await rodar('abc'), 2);
});

test('scripts do Windows: CRLF em todas as linhas, sem BOM, e INICIAR.cmd com as verificações na ordem certa', () => {
  for (const nome of ['INICIAR.cmd', 'PUBLICAR.cmd', 'SERVIDOR-PUBLICADO.cmd', 'iniciar-oculto.vbs']) {
    const bytes = readFileSync(join(RAIZ, nome));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], `${nome} sem BOM (o cmd.exe não entende)`);
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0A) assert.equal(bytes[i - 1], 0x0D, `${nome}: LF sem CR na posição ${i}`);
    assert.equal(bytes.at(-1), 0x0A, `${nome} termina com quebra de linha`);
  }
  const cmd = readFileSync(join(RAIZ, 'INICIAR.cmd'), 'latin1');
  const pos = (trecho) => { const i = cmd.indexOf(trecho); assert.ok(i >= 0, `INICIAR.cmd deveria conter: ${trecho}`); return i; };
  assert.ok(pos('cd /d "%~dp0"') < pos('if not exist "data\\" mkdir "data"'));
  assert.ok(pos('if not exist "data\\" mkdir "data"') < pos('server\\verificar-porta.mjs'));
  assert.ok(pos('server\\verificar-porta.mjs') < pos('"%NODE%" --disable-warning=ExperimentalWarning server\\server.mjs'));
  assert.ok(pos('set "ABRIR_NAVEGADOR=1"') < pos('"%NODE%" --disable-warning=ExperimentalWarning server\\server.mjs'), 'o navegador é aberto pelo servidor, depois de responder');
  // rótulos usados por goto existem
  for (const m of cmd.matchAll(/goto :?(\w+)/g)) if (m[1].toLowerCase() !== 'eof') assert.ok(new RegExp(`^:${m[1]}\\s*$`, 'm').test(cmd), `rótulo :${m[1]} existe`);
  assert.ok(!/[^\x00-\x7F]/.test(cmd.replace(/^rem .*$/gm, '')), 'fora dos comentários só ASCII (independe da página de código do console)');
});
