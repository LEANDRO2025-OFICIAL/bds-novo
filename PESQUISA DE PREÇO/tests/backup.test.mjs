import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abrirBanco } from '../server/db.mjs';
import { criarBackup, listarBackups, nomeBackup, dataDoNome } from '../server/backup.mjs';

let pasta;
before(() => { pasta = mkdtempSync(join(tmpdir(), 'bp-backup-')); });
after(() => rmSync(pasta, { recursive: true, force: true }));

function bancoComDados(nome) {
  const caminho = join(pasta, nome, 'pesquisa-precos.db');
  const db = abrirBanco(caminho);
  const p = db.prepare('INSERT INTO pesquisas (titulo, processo) VALUES (?, ?)').run('Aquisição de café', '77/2026');
  const it = db.prepare("INSERT INTO itens (pesquisa_id, descricao, tipo, quantidade) VALUES (?, 'Café torrado 500 g', 'material', 40)").run(p.lastInsertRowid);
  const ins = db.prepare("INSERT INTO amostras (item_id, origem, chave_origem, preco_unitario) VALUES (?, 'manual', ?, ?)");
  [18.9, 19.5, 21].forEach((preco, i) => ins.run(it.lastInsertRowid, `k${i}`, preco));
  db.prepare('INSERT INTO cache (chave, corpo, criado_em) VALUES (?, ?, ?)').run('https://exemplo/x', '{"grande":true}', Date.now());
  return { db, caminho };
}

describe('nome do arquivo', () => {
  test('AAAAMMDD-HHMMSS na hora local, ida e volta', () => {
    const quando = new Date(2026, 10, 11, 9, 5, 7);
    assert.equal(nomeBackup(quando), 'pesquisa-precos-20261111-090507.db');
    assert.equal(dataDoNome('pesquisa-precos-20261111-090507.db').getTime(), quando.getTime());
    assert.equal(dataDoNome('outro.db'), null);
  });
});

describe('backup do SQLite', () => {
  test('cria em data/backups, abre e contém os dados (mesmo com WAL pendente)', () => {
    const { db, caminho } = bancoComDados('a');
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.ok(existsSync(`${caminho}-wal`), 'há gravações só no WAL: cópia crua do .db ficaria incompleta');
    const r = criarBackup(db, caminho, { agora: new Date(2026, 10, 11, 10, 0, 0) });
    assert.equal(r.criado, true);
    assert.equal(r.arquivo, join(pasta, 'a', 'backups', 'pesquisa-precos-20261111-100000.db'));

    const copia = new DatabaseSync(r.arquivo, { readOnly: true });
    assert.equal(copia.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(copia.prepare('SELECT titulo, processo FROM pesquisas').get().titulo, 'Aquisição de café');
    assert.equal(copia.prepare('SELECT descricao FROM itens').get().descricao, 'Café torrado 500 g');
    assert.deepEqual(copia.prepare('SELECT preco_unitario p FROM amostras ORDER BY p').all().map((x) => x.p), [18.9, 19.5, 21]);
    assert.equal(copia.prepare('SELECT COUNT(*) n FROM cache').get().n, 0, 'cache das APIs não vai para o backup');
    copia.close();
    assert.deepEqual(readdirSync(join(pasta, 'a', 'backups')), ['pesquisa-precos-20261111-100000.db'], 'sem sobras (-wal, .parcial)');

    // o banco original segue íntegro e utilizável, com o cache preservado
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cache').get().n, 1);
    db.prepare("INSERT INTO pesquisas (titulo) VALUES ('depois do backup')").run();
    db.close();
  });

  test('no máximo um por minuto', () => {
    const { db, caminho } = bancoComDados('b');
    const t0 = new Date(2026, 10, 11, 10, 0, 0);
    const primeiro = criarBackup(db, caminho, { agora: t0 });
    const segundo = criarBackup(db, caminho, { agora: new Date(t0.getTime() + 59_000) });
    assert.equal(segundo.criado, false);
    assert.equal(segundo.arquivo, primeiro.arquivo);
    assert.match(segundo.motivo, /neste minuto/);
    const terceiro = criarBackup(db, caminho, { agora: new Date(t0.getTime() + 60_000) });
    assert.equal(terceiro.criado, true);
    assert.equal(listarBackups(join(pasta, 'b', 'backups')).length, 2);
    db.close();
  });

  test('retenção: mantém só os N mais recentes e ignora arquivos alheios', () => {
    const { db, caminho } = bancoComDados('c');
    const dir = join(pasta, 'c', 'backups');
    const t0 = new Date(2026, 10, 11, 8, 0, 0).getTime();
    for (let i = 0; i < 25; i++) criarBackup(db, caminho, { agora: new Date(t0 + i * 60_000) });
    writeFileSync(join(dir, 'anotacoes.txt'), 'não é backup');
    criarBackup(db, caminho, { agora: new Date(t0 + 25 * 60_000) });
    const nomes = listarBackups(dir).map((b) => b.nome);
    assert.equal(nomes.length, 20);
    assert.equal(nomes[0], 'pesquisa-precos-20261111-080600.db');
    assert.equal(nomes.at(-1), 'pesquisa-precos-20261111-082500.db');
    assert.ok(existsSync(join(dir, 'anotacoes.txt')));
    criarBackup(db, caminho, { agora: new Date(t0 + 26 * 60_000), retencao: 3 });
    assert.equal(listarBackups(dir).length, 3);
    db.close();
  });

  test('banco em memória não gera backup; pasta explícita gera', () => {
    const db = abrirBanco(':memory:');
    assert.deepEqual(criarBackup(db, ':memory:'), { criado: false, arquivo: null, nome: null, motivo: 'banco em memória' });
    db.prepare("INSERT INTO pesquisas (titulo) VALUES ('em memória')").run();
    const dir = join(pasta, 'd');
    const r = criarBackup(db, ':memory:', { dir });
    assert.equal(r.criado, true);
    const copia = new DatabaseSync(r.arquivo, { readOnly: true });
    assert.equal(copia.prepare('SELECT titulo FROM pesquisas').get().titulo, 'em memória');
    copia.close();
    db.close();
  });

  test('falha ao gravar vira erro claro e não deixa arquivo parcial', () => {
    const { db, caminho } = bancoComDados('e');
    const bloqueio = join(pasta, 'e', 'arquivo-no-lugar-da-pasta');
    writeFileSync(bloqueio, 'x');
    assert.throws(() => criarBackup(db, caminho, { dir: join(bloqueio, 'sub') }), /./);
    db.close();
  });
});
