// Índice local dos catálogos oficiais (PDM de materiais + serviços) para busca por texto.
// A API pública não oferece busca textual; baixamos as listas ativas (≈ 38 páginas) e indexamos em FTS5.
import { obterJson, montarUrl, PAGINA_MAX } from './compras.mjs';
import { transacao, getMeta, setMeta } from './db.mjs';

const FONTES = [
  {
    tipo: 'pdm',
    caminho: '/modulo-material/3_consultarPdmMaterial',
    params: { statusPdm: true },
    mapear: (r) => ({ codigo: r.codigoPdm, nome: r.nomePdm, grupo: r.nomeGrupo, classe: r.nomeClasse }),
  },
  {
    tipo: 'servico',
    caminho: '/modulo-servico/6_consultarItemServico',
    params: { statusServico: true },
    mapear: (r) => ({ codigo: r.codigoServico, nome: r.nomeServico, grupo: r.nomeGrupo, classe: r.nomeClasse }),
  },
];

const estado = { emAndamento: false, progresso: null, erro: null };

export function statusCatalogo(db) {
  const contagem = db.prepare('SELECT tipo, COUNT(*) n FROM catalogo GROUP BY tipo').all();
  const por = Object.fromEntries(contagem.map((c) => [c.tipo, c.n]));
  return {
    materiais: por.pdm || 0,
    servicos: por.servico || 0,
    atualizadoEm: getMeta(db, 'catalogo_atualizado_em'),
    emAndamento: estado.emAndamento,
    progresso: estado.progresso,
    erro: estado.erro,
  };
}

/** Baixa e reindexa. Idempotente; ignora chamadas concorrentes. */
export async function atualizarCatalogo(db, opts = {}) {
  if (estado.emAndamento) return statusCatalogo(db);
  estado.emAndamento = true;
  estado.erro = null;
  try {
    const linhas = [];
    for (const fonte of FONTES) {
      for (let pagina = 1; ; pagina++) {
        estado.progresso = `${fonte.tipo === 'pdm' ? 'materiais' : 'serviços'}: página ${pagina}`;
        // db = null: catálogo não vai para o cache de consultas
        const json = await obterJson(null, montarUrl(fonte.caminho, { ...fonte.params, pagina, tamanhoPagina: PAGINA_MAX }), opts);
        for (const r of json.resultado || []) {
          const m = fonte.mapear(r);
          if (m.codigo && m.nome) linhas.push({ tipo: fonte.tipo, ...m });
        }
        if (!json.paginasRestantes) break;
      }
    }
    if (!linhas.length) throw new Error('Catálogo veio vazio da fonte oficial.');
    transacao(db, () => {
      db.exec('DELETE FROM catalogo; DELETE FROM catalogo_fts;');
      const ins = db.prepare('INSERT OR REPLACE INTO catalogo (tipo, codigo, nome, grupo, classe) VALUES (?, ?, ?, ?, ?)');
      const fts = db.prepare('INSERT INTO catalogo_fts (nome, classe, grupo, tipo, codigo) VALUES (?, ?, ?, ?, ?)');
      for (const l of linhas) {
        ins.run(l.tipo, l.codigo, l.nome, l.grupo ?? null, l.classe ?? null);
        fts.run(l.nome, l.classe ?? '', l.grupo ?? '', l.tipo, l.codigo);
      }
    });
    setMeta(db, 'catalogo_atualizado_em', new Date().toISOString());
  } catch (e) {
    estado.erro = e.message;
    throw e;
  } finally {
    estado.emAndamento = false;
    estado.progresso = null;
  }
  return statusCatalogo(db);
}

function termosDe(texto) {
  return String(texto || '')
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 8)
    .map((t) => t.replaceAll('"', ''));
}

/**
 * Consultas FTS5 seguras, da mais estrita para a mais ampla:
 *   1. todas as palavras exatas   2. todas como prefixo
 *   3. qualquer palavra exata     4. qualquer palavra como prefixo
 */
export function consultasFts(texto) {
  const t = termosDe(texto);
  if (!t.length) return [];
  const exatas = t.map((x) => `"${x}"`);
  const prefixos = t.map((x) => `"${x}"*`);
  return [...new Set([exatas.join(' AND '), prefixos.join(' AND '), exatas.join(' OR '), prefixos.join(' OR ')])];
}

const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

/** Ordem dentro de uma camada: nome idêntico, nome que começa pelo termo, mais termos no nome, mais curto. */
function ordenarCamada(linhas, texto) {
  const alvo = normal(texto);
  const termos = termosDe(texto).map(normal);
  const pontuar = (r) => {
    const nome = normal(r.nome);
    const palavras = nome.split(/[^A-Z0-9]+/);
    return [
      nome === alvo ? 0 : 1,
      nome.startsWith(termos[0] + ' ') || nome === termos[0] ? 0 : 1,
      -termos.filter((t) => palavras.includes(t)).length,
      nome.length,
    ];
  };
  return linhas
    .map((r, i) => ({ r, k: [...pontuar(r), i] }))
    .sort((a, b) => { for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j]; return 0; })
    .map((x) => x.r);
}

export function buscarCatalogo(db, texto, { tipo = null, limite = 30 } = {}) {
  const q = String(texto || '').trim();
  if (/^\d{3,9}$/.test(q)) {
    return db.prepare(`SELECT tipo, codigo, nome, grupo, classe FROM catalogo WHERE codigo = ? ${tipo ? 'AND tipo = ?' : ''} LIMIT ?`)
      .all(...[Number(q), ...(tipo ? [tipo] : []), limite]);
  }
  // nome pesa mais que classe/grupo
  const stmt = db.prepare(`
    SELECT c.tipo, c.codigo, c.nome, c.grupo, c.classe
    FROM catalogo_fts f JOIN catalogo c ON c.tipo = f.tipo AND c.codigo = f.codigo
    WHERE catalogo_fts MATCH ? ${tipo ? 'AND f.tipo = ?' : ''}
    ORDER BY bm25(catalogo_fts, 10.0, 2.0, 1.0)
    LIMIT ?`);
  const vistos = new Set();
  const saida = [];
  for (const fts of consultasFts(q)) {
    const camada = ordenarCamada(stmt.all(...[fts, ...(tipo ? [tipo] : []), limite * 4]), q);
    for (const r of camada) {
      const k = `${r.tipo}:${r.codigo}`;
      if (!vistos.has(k)) { vistos.add(k); saida.push(r); }
    }
    if (saida.length >= limite) break;
  }
  return saida.slice(0, limite);
}
