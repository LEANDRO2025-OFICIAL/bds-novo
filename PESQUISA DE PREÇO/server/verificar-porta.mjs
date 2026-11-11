// Diz quem está na porta antes de subir o servidor. Usado pelo INICIAR.cmd:
//   node server/verificar-porta.mjs 5600
// Código de saída:  0 = porta livre   10 = o próprio Banco de Preços LS já está respondendo   20 = ocupada por outro programa
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const LIVRE = 0;
export const NOSSO = 10;
export const OUTRO = 20;

async function perguntar(url, ms) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
    return { respondeu: true, json: await res.json().catch(() => null) };
  } catch (e) {
    // ECONNREFUSED = ninguém escutando. Qualquer outra falha (timeout, protocolo) = há algo ali que não é HTTP nosso.
    return { respondeu: false, recusada: e.cause?.code === 'ECONNREFUSED' };
  }
}

const podeEscutar = (porta, host) => new Promise((ok) => {
  const s = createServer();
  s.once('error', () => ok(false));
  s.listen(porta, host, () => s.close(() => ok(true)));
});

export async function verificarPorta(porta, { host = '127.0.0.1', ms = 2500 } = {}) {
  const base = `http://${host}:${porta}`;
  const saude = await perguntar(`${base}/api/saude`, ms);
  if (saude.respondeu) {
    if (saude.json?.app === 'banco-de-precos-ls') return NOSSO;
    // versão anterior do sistema (sem /api/saude): reconhece pelo formato de /api/sessao
    const sessao = await perguntar(`${base}/api/sessao`, ms);
    return sessao.respondeu && sessao.json && 'exigeLogin' in sessao.json ? NOSSO : OUTRO;
  }
  if (!saude.recusada) return OUTRO;
  return (await podeEscutar(porta, host)) ? LIVRE : OUTRO;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const porta = Number(process.argv[2] || process.env.PORT || 5600);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) { console.error('Porta invalida.'); process.exit(2); }
  process.exit(await verificarPorta(porta));
}
