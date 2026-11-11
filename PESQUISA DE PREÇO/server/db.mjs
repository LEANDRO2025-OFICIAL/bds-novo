// Persistência local em SQLite nativo do Node (node:sqlite). Um arquivo só: data/pesquisa-precos.db
// abrirBanco cria a pasta (data/) se ela não existir.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS cache (
  chave TEXT PRIMARY KEY,
  corpo TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogo (
  tipo TEXT NOT NULL CHECK (tipo IN ('pdm', 'servico')),
  codigo INTEGER NOT NULL,
  nome TEXT NOT NULL,
  grupo TEXT,
  classe TEXT,
  PRIMARY KEY (tipo, codigo)
);
CREATE VIRTUAL TABLE IF NOT EXISTS catalogo_fts USING fts5(
  nome, classe, grupo, tipo UNINDEXED, codigo UNINDEXED,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS pesquisas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  processo TEXT,
  orgao TEXT,
  responsavel TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itens (
  id INTEGER PRIMARY KEY,
  pesquisa_id INTEGER NOT NULL REFERENCES pesquisas(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL DEFAULT 0,
  descricao TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('material', 'servico')),
  codigo_tipo TEXT CHECK (codigo_tipo IN ('pdm', 'item', 'servico')),
  codigo INTEGER,
  unidade TEXT,
  quantidade REAL NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  metodo TEXT NOT NULL DEFAULT 'auto' CHECK (metodo IN ('auto', 'media', 'mediana', 'menor')),
  criterio TEXT NOT NULL DEFAULT '{"tipo":"nenhum"}',
  observacao TEXT
);
CREATE INDEX IF NOT EXISTS itens_pesquisa ON itens(pesquisa_id, ordem);

CREATE TABLE IF NOT EXISTS amostras (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  origem TEXT NOT NULL,
  chave_origem TEXT NOT NULL,
  data_compra TEXT,
  orgao TEXT,
  uasg TEXT,
  uf TEXT,
  municipio TEXT,
  fornecedor_ni TEXT,
  fornecedor_nome TEXT,
  marca TEXT,
  descricao TEXT,
  unidade TEXT,
  quantidade REAL,
  preco_unitario REAL NOT NULL CHECK (preco_unitario >= 0),
  objeto TEXT,
  link TEXT,
  manual INTEGER CHECK (manual IN (0, 1)),
  justificativa TEXT,
  coletado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, chave_origem)
);
CREATE INDEX IF NOT EXISTS amostras_item ON amostras(item_id);

-- Trilha de auditoria das decisões sobre amostras (art. 6º, § 3º): quem desconsiderou/reconsiderou o quê, quando e por quê.
CREATE TABLE IF NOT EXISTS decisoes (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
  amostra_id INTEGER NOT NULL,
  acao TEXT NOT NULL CHECK (acao IN ('desconsiderar', 'considerar', 'criterio', 'justificar', 'remover')),
  preco_unitario REAL,
  justificativa TEXT,
  usuario TEXT,
  em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS decisoes_item ON decisoes(item_id, id);
`;

// Colunas acrescentadas depois da 1ª versão. Só ADD COLUMN: bancos existentes são preservados.
const COLUNAS_NOVAS = [
  ['pesquisas', 'metodo_padrao', "TEXT NOT NULL DEFAULT 'auto'"],
  ['pesquisas', 'criterio_padrao', `TEXT NOT NULL DEFAULT '{"tipo":"nenhum"}'`],
];

function migrar(db) {
  for (const [tabela, coluna, definicao] of COLUNAS_NOVAS) {
    const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
    if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  }
}

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec(SCHEMA);
  migrar(db);
  return db;
}

export function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getMeta(db, chave) {
  return db.prepare('SELECT valor FROM meta WHERE chave = ?').get(chave)?.valor ?? null;
}

export function setMeta(db, chave, valor) {
  db.prepare('INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, String(valor));
}
