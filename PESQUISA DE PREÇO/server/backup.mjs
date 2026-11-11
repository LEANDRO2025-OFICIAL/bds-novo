// Cópia de segurança do SQLite. Usa VACUUM INTO: gera um arquivo íntegro e compacto a partir de um
// instantâneo consistente, mesmo com o banco aberto em modo WAL (copiar o .db "cru" perderia o que ainda está no -wal).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const NOME_RE = /^pesquisa-precos-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;
const dois = (n) => String(n).padStart(2, '0');

/** pesquisa-precos-AAAAMMDD-HHMMSS.db (hora local do computador). */
export function nomeBackup(quando = new Date()) {
  return `pesquisa-precos-${quando.getFullYear()}${dois(quando.getMonth() + 1)}${dois(quando.getDate())}-${dois(quando.getHours())}${dois(quando.getMinutes())}${dois(quando.getSeconds())}.db`;
}

/** Data (local) gravada no nome do arquivo, ou null se o nome não for de backup. */
export function dataDoNome(nome) {
  const m = NOME_RE.exec(nome);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) : null;
}

export function pastaBackups(caminhoDb, dir = null) {
  if (dir) return dir;
  return caminhoDb && caminhoDb !== ':memory:' ? join(dirname(caminhoDb), 'backups') : null;
}

/** Backups existentes, do mais antigo para o mais novo. */
export function listarBackups(dir) {
  let nomes;
  try { nomes = readdirSync(dir); } catch { return []; }
  return nomes.filter((n) => NOME_RE.test(n)).sort().map((nome) => {
    const arquivo = join(dir, nome);
    let bytes = null;
    try { bytes = statSync(arquivo).size; } catch { /* removido em paralelo */ }
    return { nome, arquivo, data: dataDoNome(nome), bytes };
  });
}

/**
 * Cria data/backups/pesquisa-precos-AAAAMMDD-HHMMSS.db.
 * - no máximo um por `intervaloMs` (padrão 1 min): dentro do intervalo devolve o último, sem criar outro;
 * - mantém só os `retencao` mais recentes (padrão 20);
 * - o cache de consultas às APIs fica de fora (é reconstruível e pode ter dezenas de MB).
 * Devolve { criado, arquivo, nome, motivo }. Banco em memória sem `dir`: não faz nada.
 */
export function criarBackup(db, caminhoDb, { agora = new Date(), retencao = 20, intervaloMs = 60_000, dir = null } = {}) {
  const pasta = pastaBackups(caminhoDb, dir);
  if (!pasta) return { criado: false, arquivo: null, nome: null, motivo: 'banco em memória' };
  mkdirSync(pasta, { recursive: true });

  const existentes = listarBackups(pasta);
  const ultimo = existentes.at(-1);
  if (ultimo && Math.abs(agora - ultimo.data) < intervaloMs) {
    return { criado: false, arquivo: ultimo.arquivo, nome: ultimo.nome, motivo: 'já existe backup neste minuto' };
  }

  const nome = nomeBackup(agora);
  const destino = join(pasta, nome);
  const temporario = join(pasta, `.${nome}.parcial`);
  rmSync(temporario, { force: true });
  try {
    db.prepare('VACUUM INTO ?').run(temporario);
    const copia = new DatabaseSync(temporario);
    try {
      copia.exec('PRAGMA journal_mode = DELETE; DELETE FROM cache; VACUUM;');
      const ok = copia.prepare('PRAGMA quick_check').get();
      if (Object.values(ok)[0] !== 'ok') throw new Error('a cópia não passou na verificação de integridade');
    } finally {
      copia.close();
    }
    renameSync(temporario, destino);
  } catch (e) {
    for (const sobra of [temporario, `${temporario}-wal`, `${temporario}-shm`, `${temporario}-journal`]) rmSync(sobra, { force: true });
    throw new Error(`Não foi possível criar a cópia de segurança: ${e.message}`);
  }

  const todos = listarBackups(pasta);
  for (const velho of todos.slice(0, Math.max(0, todos.length - Math.max(1, retencao)))) rmSync(velho.arquivo, { force: true });
  return { criado: true, arquivo: destino, nome, motivo: null };
}
