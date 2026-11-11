// Servidor do sistema de pesquisa de preços. Uso: node server/server.mjs  (porta 5600 por padrão)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao } from './db.mjs';
import { consultarPrecos, limparCacheAntigo, ErroApi } from './compras.mjs';
import { consultarPrecosPncp } from './pncp.mjs';
import { atualizarCatalogo, buscarCatalogo, statusCatalogo } from './catalogo.mjs';
import { analisarItem } from './estatistica.mjs';
import { gerarCsv } from './csv.mjs';
import { criarBackup, listarBackups, pastaBackups } from './backup.mjs';
import { renderizarMapa } from './mapa.mjs';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { carregarUsuarios, criarAuth, lerCookie } from './auth.mjs';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLICO = join(RAIZ, 'public');
const PORTA = Number(process.env.PORT || 5600);
const HOST = process.env.HOST || '127.0.0.1';

const DB_PATH = process.env.DB_PATH || join(RAIZ, 'data', 'pesquisa-precos.db');
const BACKUP_DIR = process.env.BACKUP_DIR || null;
const BACKUP_RETENCAO = Math.max(1, Math.round(Number(process.env.BACKUP_RETENCAO) || 20));
const FUSO = process.env.FUSO_HORARIO || undefined;

// abrirBanco cria a pasta de dados (data/) se ela ainda não existir.
export const db = abrirBanco(DB_PATH);
try { limparCacheAntigo(db); } catch (e) { console.error('[cache] limpeza falhou:', e.message); }

/**
 * Cópia de segurança antes de operações sensíveis (mapa, CSV, exclusões em lote).
 * obrigatorio = true: se a cópia falhar, a operação é cancelada (exclusões). Caso contrário só registra o erro.
 */
function backupAntes(motivo, { obrigatorio = false } = {}) {
  try {
    const r = criarBackup(db, DB_PATH, { dir: BACKUP_DIR, retencao: BACKUP_RETENCAO });
    if (r.criado) console.log(`[backup] ${r.nome} (${motivo})`);
    return r;
  } catch (e) {
    console.error(`[backup] ${e.message}`);
    if (obrigatorio) throw new ErroHttp(500, `${e.message} A operação foi cancelada para proteger seus dados.`);
    return { criado: false, arquivo: null, nome: null, motivo: e.message };
  }
}
// Usuários: variável USUARIOS (Render) ou arquivo USUARIOS_ARQUIVO (PUBLICAR.cmd). Sem nenhum, o login fica
// desligado e só o próprio computador acessa: pedidos via proxy/túnel são recusados (ver servidor abaixo).
const USUARIOS_ARQUIVO = process.env.USUARIOS_ARQUIVO;
const auth = criarAuth(carregarUsuarios(process.env.USUARIOS || (USUARIOS_ARQUIVO && existsSync(USUARIOS_ARQUIVO) ? readFileSync(USUARIOS_ARQUIVO, 'utf8') : '')));

const TIPOS = { '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

// ---------------------------------------------------------------- utilitários

function enviarJson(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

async function lerCorpo(req) {
  let tamanho = 0;
  const partes = [];
  for await (const p of req) {
    tamanho += p.length;
    if (tamanho > 1_000_000) throw new ErroHttp(413, 'Corpo da requisição muito grande.');
    partes.push(p);
  }
  if (!partes.length) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw new ErroHttp(400, 'JSON inválido.'); }
}

const texto = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const numero = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Só links http(s): bloqueia javascript:, data: etc. (o link vira href na interface). */
export function linkSeguro(v) {
  const s = texto(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function exigir(cond, msg) { if (!cond) throw new ErroHttp(400, msg); }

// ---------------------------------------------------------------- domínio

function itemComAnalise(item) {
  const amostras = db.prepare('SELECT * FROM amostras WHERE item_id = ? ORDER BY preco_unitario').all(item.id);
  const criterio = JSON.parse(item.criterio || '{"tipo":"nenhum"}');
  const analise = analisarItem(
    amostras.map((a) => ({ id: a.id, preco: a.preco_unitario, manual: a.manual === null ? null : a.manual === 1 })),
    { criterio, metodo: item.metodo, quantidade: item.quantidade },
  );
  const porId = new Map(analise.decisoes.map((d) => [d.id, d]));
  return {
    ...item,
    criterio,
    amostras: amostras.map((a) => ({ ...a, incluida: porId.get(a.id).incluida, motivo: porId.get(a.id).motivo })),
    estimativa: analise.estimativa,
    total: analise.total,
    limites: analise.limites,
  };
}

function carregarPesquisa(id) {
  const p = db.prepare('SELECT * FROM pesquisas WHERE id = ?').get(id);
  if (!p) throw new ErroHttp(404, 'Pesquisa não encontrada.');
  const itens = db.prepare('SELECT * FROM itens WHERE pesquisa_id = ? ORDER BY ordem, id').all(id).map(itemComAnalise);
  const totalGeral = itens.reduce((s, i) => s + (i.total || 0), 0);
  return { ...p, criterio_padrao: lerCriterio(p.criterio_padrao), itens, totalGeral: Math.round(totalGeral * 100) / 100 };
}

function lerCriterio(textoJson) {
  try { return JSON.parse(textoJson || '{"tipo":"nenhum"}'); } catch { return { tipo: 'nenhum' }; }
}

const METODOS = ['auto', 'media', 'mediana', 'menor'];
/** Valida e reduz o critério às chaves conhecidas. Devolve o JSON a gravar. */
function validarCriterio(c) {
  const crit = c || { tipo: 'nenhum' };
  exigir(['nenhum', 'desvio', 'iqr', 'mediana'].includes(crit.tipo), 'Critério inválido.');
  const limpo = { tipo: crit.tipo };
  const chaves = { desvio: ['k'], iqr: ['k'], mediana: ['inferior', 'superior'] }[crit.tipo] || [];
  for (const k of chaves) {
    if (crit[k] === undefined || crit[k] === null || crit[k] === '') continue;
    const n = Number(crit[k]);
    exigir(Number.isFinite(n) && n >= 0 && n <= 10 && (k !== 'k' || n > 0), `Parâmetro ${k} inválido.`);
    limpo[k] = n;
  }
  return JSON.stringify(limpo);
}

function tocarPesquisa(id) {
  db.prepare("UPDATE pesquisas SET atualizado_em = datetime('now') WHERE id = ?").run(id);
}

function validarItem(b, parcial = false) {
  const it = {};
  if (!parcial || b.descricao !== undefined) { it.descricao = texto(b.descricao, 2000); exigir(it.descricao, 'Descrição do item é obrigatória.'); }
  if (!parcial || b.tipo !== undefined) { it.tipo = b.tipo === 'servico' ? 'servico' : 'material'; }
  if (b.codigoTipo !== undefined) { it.codigo_tipo = ['pdm', 'item', 'servico'].includes(b.codigoTipo) ? b.codigoTipo : null; }
  if (b.codigo !== undefined) { it.codigo = numero(b.codigo); exigir(it.codigo === null || Number.isInteger(it.codigo), 'Código inválido.'); }
  if (b.unidade !== undefined) it.unidade = texto(b.unidade, 60);
  if (!parcial || b.quantidade !== undefined) { it.quantidade = numero(b.quantidade ?? 1); exigir(it.quantidade > 0, 'Quantidade deve ser maior que zero.'); }
  if (b.metodo !== undefined) { exigir(METODOS.includes(b.metodo), 'Método inválido.'); it.metodo = b.metodo; }
  if (b.criterio !== undefined) it.criterio = validarCriterio(b.criterio);
  if (b.observacao !== undefined) it.observacao = texto(b.observacao, 4000);
  return it;
}

function atualizar(tabela, id, campos) {
  const chaves = Object.keys(campos);
  if (!chaves.length) return;
  db.prepare(`UPDATE ${tabela} SET ${chaves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...chaves.map((k) => campos[k]), id);
}

// ---------------------------------------------------------------- rotas

const rotas = [];
const rota = (metodo, padrao, fn) => rotas.push({ metodo, re: new RegExp(`^${padrao.replace(/:(\w+)/g, '(?<$1>\\d+)')}$`), fn });

const COOKIE = 'sessao';
const ROTAS_LIVRES = new Set(['/api/saude', '/api/sessao', '/api/login', '/api/logout']);
// Atrás do proxy do Render o IP real é o último do x-forwarded-for (o cliente só controla os anteriores).
const ipDe = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
function gravarCookie(req, res, valor, maxAge) {
  const seguro = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('set-cookie', `${COOKIE}=${valor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${seguro}`);
}

const usuarioDe = (req) => auth.usuario(lerCookie(req, COOKIE)) || 'local';

// Identidade do serviço: o INICIAR.cmd usa para saber se quem está na porta é o próprio sistema. Não expõe dados.
rota('GET', '/api/saude', () => ({ app: 'banco-de-precos-ls', ok: true }));
rota('GET', '/api/sessao', ({ req }) => ({ exigeLogin: auth.ativo, usuario: auth.usuario(lerCookie(req, COOKIE)) }));
rota('POST', '/api/login', async ({ req, res }) => {
  const b = await lerCorpo(req);
  const r = auth.login(b.usuario, b.senha, ipDe(req));
  if (r.erro) throw new ErroHttp(r.status, r.erro);
  gravarCookie(req, res, r.token, auth.maxAgeSeg);
  return { usuario: r.usuario };
});
rota('POST', '/api/logout', ({ req, res }) => {
  auth.logout(lerCookie(req, COOKIE));
  gravarCookie(req, res, '', 0);
  return { ok: true };
});

rota('GET', '/api/catalogo/status', () => statusCatalogo(db));
rota('POST', '/api/catalogo/atualizar', () => {
  atualizarCatalogo(db).catch((e) => console.error('[catalogo]', e.message));
  return statusCatalogo(db);
});
rota('GET', '/api/catalogo/buscar', ({ url }) => {
  const tipo = url.searchParams.get('tipo');
  return buscarCatalogo(db, url.searchParams.get('q'), { tipo: ['pdm', 'servico'].includes(tipo) ? tipo : null });
});

/** Consulta as fontes pedidas em paralelo; uma fonte fora do ar vira aviso se a outra respondeu. */
async function consultarFontes(fontes, filtros, opcoes = {}) {
  const nomes = { compras: 'Compras.gov.br', pncp: 'PNCP' };
  // termoPncp: texto da busca no PNCP quando o usuário não deu palavras-chave (não filtra o Compras.gov.br)
  const consultas = { compras: consultarPrecos, pncp: (d, f, o) => consultarPrecosPncp(d, { ...f, palavras: f.palavras || f.termoPncp }, o) };
  const res = await Promise.allSettled(fontes.map((f) => consultas[f](db, filtros, opcoes)));
  const ok = res.flatMap((r, i) => (r.status === 'fulfilled' ? [{ fonte: fontes[i], ...r.value }] : []));
  if (!ok.length) throw res[0].reason;
  const avisos = res.flatMap((r, i) => (r.status === 'rejected' ? [`${nomes[fontes[i]]} indisponível: ${r.reason.message}`] : []));
  for (const r of res) if (r.status === 'rejected' && !(r.reason instanceof ErroApi)) console.error(r.reason);

  // Compras federais saem nas duas fontes: o PNCP só entra se não repetir fornecedor + preço + data do Compras.gov.br.
  // shortcut: chave aproximada (sem nº da compra, que difere entre os portais); se houver falso positivo, comparar também a UASG.
  const chave = (x) => `${x.fornecedorNi}|${x.precoUnitario}|${x.dataCompra}`;
  const doCompras = new Set(ok.filter((r) => r.fonte === 'compras').flatMap((r) => r.registros.map(chave)));
  const registros = ok.flatMap((r) => (r.fonte === 'pncp' ? r.registros.filter((x) => !doCompras.has(chave(x))) : r.registros));
  registros.sort((a, b) => String(b.dataCompra).localeCompare(String(a.dataCompra)));
  return {
    registros,
    totalNaFonte: ok.reduce((s, r) => s + r.totalNaFonte, 0),
    truncado: ok.some((r) => r.truncado),
    avisos: [...ok.flatMap((r) => r.avisos || []), ...avisos],
    // por fonte: de onde veio a resposta (rede, cache válido ou cache vencido por indisponibilidade)
    fontes: ok.map((r) => ({ fonte: r.fonte, nome: nomes[r.fonte], cache: r.cache || null })),
    consultadoEm: new Date().toISOString(),
  };
}

rota('GET', '/api/precos', async ({ url }) => {
  const q = Object.fromEntries(url.searchParams);
  const fonte = q.fonte || 'compras';
  exigir(['compras', 'pncp', 'ambas'].includes(fonte), 'Fonte inválida (use compras, pncp ou ambas).');
  const palavras = (q.palavras || '').trim();
  // PNCP só busca por texto: sem palavras-chave, usa o nome do código escolhido no catálogo oficial
  const tipoCatalogo = q.tipo === 'servico' ? 'servico' : q.codigoTipo === 'item' ? null : 'pdm';
  const termoPncp = palavras.length >= 3 ? null
    : (tipoCatalogo && /^\d+$/.test(q.codigo || '') && db.prepare('SELECT nome FROM catalogo WHERE tipo = ? AND codigo = ?').get(tipoCatalogo, Number(q.codigo))?.nome) || null;
  if (fonte !== 'pncp') exigir(/^\d+$/.test(q.codigo || ''), 'Código do catálogo inválido.');
  if (fonte === 'pncp') exigir(palavras.length >= 3 || termoPncp, 'Informe palavras-chave (mín. 3 letras) para buscar no PNCP.');
  for (const d of ['inicio', 'fim']) if (q[d]) exigir(DATA_RE.test(q[d]), `Data ${d} inválida (use AAAA-MM-DD).`);
  if (q.uf) exigir(/^[A-Z]{2}$/.test(q.uf), 'UF inválida.');
  const fontes = fonte === 'ambas' ? ['compras', 'pncp'] : [fonte];
  const semPncp = fonte === 'ambas' && palavras.length < 3 && !termoPncp;
  const r = await consultarFontes(semPncp ? ['compras'] : fontes, {
    termoPncp,
    tipo: q.tipo === 'servico' ? 'servico' : 'material',
    codigoTipo: q.codigoTipo,
    codigo: q.codigo,
    uf: q.uf,
    inicio: q.inicio,
    fim: q.fim,
    palavras,
  }, { semCache: q.atualizar === '1' });
  if (semPncp) r.avisos.push('PNCP não consultado: informe palavras-chave (mín. 3 letras) para buscar também no PNCP.');
  if (termoPncp && fontes.includes('pncp')) r.avisos.push(`PNCP buscado por “${termoPncp}” (nome no catálogo). Informe palavras-chave para refinar.`);
  return r;
});

function padroesDaPesquisa(b, campos = {}) {
  if (b.metodoPadrao !== undefined) { exigir(METODOS.includes(b.metodoPadrao), 'Método inválido.'); campos.metodo_padrao = b.metodoPadrao; }
  if (b.criterioPadrao !== undefined) campos.criterio_padrao = validarCriterio(b.criterioPadrao);
  return campos;
}

rota('GET', '/api/pesquisas', () => db.prepare('SELECT id FROM pesquisas ORDER BY atualizado_em DESC, id DESC').all().map(({ id }) => {
  const { itens, ...p } = carregarPesquisa(id);
  const amostras = itens.reduce((s, i) => s + i.amostras.length, 0);
  const validas = itens.reduce((s, i) => s + i.estimativa.resumo.n, 0);
  return { ...p, total_itens: itens.length, total_amostras: amostras, total_validas: validas, itens_insuficientes: itens.filter((i) => i.estimativa.resumo.n < 3).length };
}));
rota('POST', '/api/pesquisas', async ({ req }) => {
  const b = await lerCorpo(req);
  const titulo = texto(b.titulo, 300);
  exigir(titulo, 'Título é obrigatório.');
  const padroes = padroesDaPesquisa(b);
  const r = db.prepare('INSERT INTO pesquisas (titulo, processo, orgao, responsavel, metodo_padrao, criterio_padrao) VALUES (?, ?, ?, ?, ?, ?)')
    .run(titulo, texto(b.processo, 100), texto(b.orgao, 300), texto(b.responsavel, 200), padroes.metodo_padrao ?? 'auto', padroes.criterio_padrao ?? '{"tipo":"nenhum"}');
  return carregarPesquisa(Number(r.lastInsertRowid));
});
rota('GET', '/api/pesquisas/:id', ({ p }) => carregarPesquisa(Number(p.id)));
rota('PUT', '/api/pesquisas/:id', async ({ req, p }) => {
  carregarPesquisa(Number(p.id));
  const b = await lerCorpo(req);
  const campos = {};
  if (b.titulo !== undefined) { campos.titulo = texto(b.titulo, 300); exigir(campos.titulo, 'Título é obrigatório.'); }
  for (const [k, max] of [['processo', 100], ['orgao', 300], ['responsavel', 200]]) if (b[k] !== undefined) campos[k] = texto(b[k], max);
  padroesDaPesquisa(b, campos);
  atualizar('pesquisas', Number(p.id), campos);
  tocarPesquisa(Number(p.id));
  return carregarPesquisa(Number(p.id));
});
rota('DELETE', '/api/pesquisas/:id', ({ p }) => {
  carregarPesquisa(Number(p.id));
  backupAntes('exclusão de pesquisa', { obrigatorio: true }); // apaga itens e amostras em cascata
  db.prepare('DELETE FROM pesquisas WHERE id = ?').run(Number(p.id));
  return { ok: true };
});
rota('GET', '/api/pesquisas/:id/csv', ({ p, res }) => {
  const pesq = carregarPesquisa(Number(p.id));
  backupAntes('exportação CSV');
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="banco-de-precos-ls-${pesq.id}.csv"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(gerarCsv(pesq));
  return undefined;
});
// Mapa de preços: página pronta para impressão / "Salvar como PDF". Fica sob /api/ para exigir login quando publicado.
rota('GET', '/api/pesquisas/:id/mapa', ({ p, req, res }) => {
  const pesq = carregarPesquisa(Number(p.id));
  backupAntes('mapa de preços');
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'self'; img-src 'self' data:; style-src 'self' 'nonce-${nonce}'; script-src 'self'; base-uri 'self'; form-action 'self'`,
    'referrer-policy': 'same-origin',
  });
  res.end(renderizarMapa(pesq, { nonce, fuso: FUSO, usuario: auth.ativo ? usuarioDe(req) : null }));
  return undefined;
});

// Exclusão em lote de itens (com suas amostras). Sempre precedida de backup; se o backup falhar, nada é apagado.
rota('POST', '/api/pesquisas/:id/itens/excluir-lote', async ({ req, p }) => {
  const pid = Number(p.id);
  carregarPesquisa(pid);
  const b = await lerCorpo(req);
  exigir(Array.isArray(b.ids) && b.ids.length > 0, 'Informe os itens a excluir.');
  exigir(b.ids.length <= 1000, 'Máximo de 1000 itens por exclusão.');
  const ids = [...new Set(b.ids.map(Number))];
  exigir(ids.every((n) => Number.isInteger(n) && n > 0), 'Identificador de item inválido.');
  const pertence = db.prepare('SELECT id FROM itens WHERE id = ? AND pesquisa_id = ?');
  exigir(ids.every((id) => pertence.get(id, pid)), 'Há itens que não pertencem a esta pesquisa.');
  const backup = backupAntes('exclusão em lote', { obrigatorio: true });
  const apagar = db.prepare('DELETE FROM itens WHERE id = ? AND pesquisa_id = ?');
  let excluidos = 0;
  transacao(db, () => { for (const id of ids) excluidos += Number(apagar.run(id, pid).changes); });
  tocarPesquisa(pid);
  return { excluidos, backup: backup.nome, pesquisa: carregarPesquisa(pid) };
});

rota('GET', '/api/backups', () => {
  const pasta = pastaBackups(DB_PATH, BACKUP_DIR);
  const lista = pasta ? listarBackups(pasta) : [];
  return { retencao: BACKUP_RETENCAO, total: lista.length, ultimo: lista.at(-1) ? { nome: lista.at(-1).nome, data: lista.at(-1).data.toISOString(), bytes: lista.at(-1).bytes } : null };
});
rota('POST', '/api/backups', () => {
  const r = backupAntes('pedido manual', { obrigatorio: true });
  return { criado: r.criado, nome: r.nome, motivo: r.motivo };
});

rota('POST', '/api/pesquisas/:id/itens', async ({ req, p }) => {
  const pid = Number(p.id);
  const pesq = carregarPesquisa(pid);
  const it = validarItem(await lerCorpo(req));
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM itens WHERE pesquisa_id = ?').get(pid).o;
  const r = db.prepare(`INSERT INTO itens (pesquisa_id, ordem, descricao, tipo, codigo_tipo, codigo, unidade, quantidade, metodo, criterio, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, ordem, it.descricao, it.tipo, it.codigo_tipo ?? null, it.codigo ?? null, it.unidade ?? null, it.quantidade, it.metodo ?? pesq.metodo_padrao ?? 'auto', it.criterio ?? JSON.stringify(pesq.criterio_padrao), it.observacao ?? null);
  tocarPesquisa(pid);
  return itemComAnalise(db.prepare('SELECT * FROM itens WHERE id = ?').get(Number(r.lastInsertRowid)));
});

function carregarItem(id) {
  const it = db.prepare('SELECT * FROM itens WHERE id = ?').get(id);
  if (!it) throw new ErroHttp(404, 'Item não encontrado.');
  return it;
}

rota('GET', '/api/itens/:id', ({ p }) => itemComAnalise(carregarItem(Number(p.id))));
rota('PUT', '/api/itens/:id', async ({ req, p }) => {
  const it = carregarItem(Number(p.id));
  atualizar('itens', it.id, validarItem(await lerCorpo(req), true));
  tocarPesquisa(it.pesquisa_id);
  return itemComAnalise(carregarItem(it.id));
});
rota('DELETE', '/api/itens/:id', ({ p }) => {
  const it = carregarItem(Number(p.id));
  db.prepare('DELETE FROM itens WHERE id = ?').run(it.id);
  tocarPesquisa(it.pesquisa_id);
  return { ok: true };
});

rota('POST', '/api/itens/:id/amostras', async ({ req, p }) => {
  const it = carregarItem(Number(p.id));
  const b = await lerCorpo(req);
  exigir(Array.isArray(b.amostras) && b.amostras.length > 0, 'Envie ao menos uma amostra.');
  exigir(b.amostras.length <= 500, 'Máximo de 500 amostras por envio.');
  const ins = db.prepare(`INSERT OR IGNORE INTO amostras (item_id, origem, chave_origem, data_compra, orgao, uasg, uf, municipio, fornecedor_ni, fornecedor_nome, marca, descricao, unidade, quantidade, preco_unitario, objeto, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let inseridas = 0;
  transacao(db, () => {
    for (const a of b.amostras) {
      const preco = Number(a.precoUnitario);
      exigir(Number.isFinite(preco) && preco >= 0, 'Preço unitário inválido.');
      const origem = texto(a.origem, 40) || 'manual';
      const chave = texto(a.chaveOrigem, 120) || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      exigir(!a.dataCompra || DATA_RE.test(a.dataCompra), 'Data da amostra inválida.');
      const r = ins.run(it.id, origem, chave, a.dataCompra || null, texto(a.orgao), texto(a.uasg, 20), texto(a.uf, 2), texto(a.municipio, 120),
        texto(a.fornecedorNi, 20), texto(a.fornecedorNome, 300), texto(a.marca, 200), texto(a.descricao, 4000), texto(a.unidade, 60),
        numero(a.quantidade), preco, texto(a.objeto, 2000), linkSeguro(a.link));
      inseridas += Number(r.changes);
    }
  });
  tocarPesquisa(it.pesquisa_id);
  return { inseridas, ignoradas: b.amostras.length - inseridas, item: itemComAnalise(carregarItem(it.id)) };
});

function carregarAmostra(id) {
  const a = db.prepare('SELECT * FROM amostras WHERE id = ?').get(id);
  if (!a) throw new ErroHttp(404, 'Amostra não encontrada.');
  return a;
}

const registrarDecisao = (a, acao, justificativa, usuario) => db.prepare('INSERT INTO decisoes (item_id, amostra_id, acao, preco_unitario, justificativa, usuario) VALUES (?, ?, ?, ?, ?, ?)')
  .run(a.item_id, a.id, acao, a.preco_unitario, justificativa ?? null, usuario);

// manual: false = desconsiderar (justificativa obrigatória) · true = considerar mesmo contra o critério · null = voltar ao critério.
// Toda decisão vai para a trilha de auditoria (tabela decisoes) e pode ser revertida.
rota('PUT', '/api/amostras/:id', async ({ req, p }) => {
  const a = carregarAmostra(Number(p.id));
  const b = await lerCorpo(req);
  const campos = {};
  if (b.manual !== undefined) { exigir([null, true, false].includes(b.manual), 'Valor de inclusão inválido.'); campos.manual = b.manual === null ? null : b.manual ? 1 : 0; }
  if (b.justificativa !== undefined) campos.justificativa = texto(b.justificativa, 2000);
  if (campos.manual === 0) exigir(campos.justificativa ?? a.justificativa, 'Justifique a exclusão manual (art. 6º, § 3º).');
  // Ao reconsiderar ou voltar ao critério, a justificativa da exclusão anterior deixa de valer (segue na trilha).
  if (b.manual !== undefined && campos.manual !== 0 && b.justificativa === undefined) campos.justificativa = null;
  const usuario = usuarioDe(req);
  transacao(db, () => {
    atualizar('amostras', a.id, campos);
    if (b.manual !== undefined) registrarDecisao(a, campos.manual === 0 ? 'desconsiderar' : campos.manual === 1 ? 'considerar' : 'criterio', campos.justificativa, usuario);
    else if (b.justificativa !== undefined) registrarDecisao(a, 'justificar', campos.justificativa, usuario);
  });
  const it = carregarItem(a.item_id);
  tocarPesquisa(it.pesquisa_id);
  return itemComAnalise(it);
});
rota('DELETE', '/api/amostras/:id', ({ req, p }) => {
  const a = carregarAmostra(Number(p.id));
  transacao(db, () => {
    registrarDecisao(a, 'remover', a.justificativa, usuarioDe(req));
    db.prepare('DELETE FROM amostras WHERE id = ?').run(a.id);
  });
  const it = carregarItem(a.item_id);
  tocarPesquisa(it.pesquisa_id);
  return itemComAnalise(it);
});
rota('GET', '/api/itens/:id/historico', ({ p }) => {
  const it = carregarItem(Number(p.id));
  return db.prepare('SELECT id, amostra_id, acao, preco_unitario, justificativa, usuario, em FROM decisoes WHERE item_id = ? ORDER BY id DESC LIMIT 500').all(it.id);
});

// ---------------------------------------------------------------- servidor

async function servirEstatico(caminho, res) {
  const rel = normalize(decodeURIComponent(caminho)).replace(/^([/\\])+/, '') || 'index.html';
  const arquivo = join(PUBLICO, rel);
  if (!arquivo.startsWith(PUBLICO + sep)) throw new ErroHttp(403, 'Acesso negado.');
  let corpo;
  let alvo = arquivo;
  try {
    corpo = await readFile(arquivo);
  } catch {
    if (extname(rel)) throw new ErroHttp(404, 'Arquivo não encontrado.');
    alvo = join(PUBLICO, 'index.html'); // rotas do front (SPA)
    corpo = await readFile(alvo);
  }
  res.writeHead(200, {
    'content-type': TIPOS[extname(alvo)] || 'application/octet-stream',
    'cache-control': extname(alvo) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
    'referrer-policy': 'same-origin',
  });
  res.end(corpo);
}

export const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    // Túnel/proxy (Tailscale Funnel, Cloudflare, Render) sempre põe x-forwarded-for; acesso direto local não.
    if (!auth.ativo && req.headers['x-forwarded-for']) throw new ErroHttp(403, 'Acesso externo desativado: publique pelo PUBLICAR.cmd (com login).');
    if (url.pathname.startsWith('/api/')) {
      if (auth.ativo && !ROTAS_LIVRES.has(url.pathname) && !auth.usuario(lerCookie(req, COOKIE))) throw new ErroHttp(401, 'Faça login para continuar.');
      for (const r of rotas) {
        const m = r.metodo === req.method && r.re.exec(url.pathname);
        if (!m) continue;
        const resultado = await r.fn({ req, res, url, p: m.groups || {} });
        if (resultado !== undefined) enviarJson(res, 200, resultado);
        return;
      }
      throw new ErroHttp(404, 'Rota não encontrada.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
    await servirEstatico(url.pathname, res);
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : e instanceof ErroApi ? 502 : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) enviarJson(res, status, { erro: status === 500 ? 'Erro interno no servidor.' : e.message });
    else res.end();
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if ((USUARIOS_ARQUIVO || !['127.0.0.1', 'localhost', '::1'].includes(HOST)) && !auth.ativo) {
    console.error(`Recusado: publicação sem login. Cadastre usuários em ${USUARIOS_ARQUIVO || 'USUARIOS="nome:senha;outro:senha"'}.`);
    process.exit(1);
  }
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nA porta ${PORTA} já está em uso.`);
      console.error(`- Se o Banco de Preços LS já está aberto em outra janela, use-o em http://localhost:${PORTA}/ (não é preciso iniciar de novo).`);
      console.error('- Se for outro programa, feche-o ou escolha outra porta: defina a variável PORT (ex.: PORT=5610) e inicie novamente.');
    } else if (e.code === 'EACCES') {
      console.error(`\nSem permissão para usar a porta ${PORTA}. Escolha uma porta acima de 1024 (variável PORT).`);
    } else {
      console.error(`\nNão foi possível iniciar o servidor: ${e.message}`);
    }
    process.exit(1);
  });
  servidor.listen(PORTA, HOST, () => {
    const endereco = `http://${HOST === '127.0.0.1' || HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}/`;
    console.log(`Banco de Preços LS em ${endereco}`);
    if (DB_PATH !== ':memory:') console.log(`Dados em ${DB_PATH}`);
    // INICIAR.cmd define ABRIR_NAVEGADOR=1: o navegador só abre aqui, depois que o servidor já está aceitando conexões.
    if (process.env.ABRIR_NAVEGADOR === '1') {
      const comando = process.platform === 'win32' ? `start "" "${endereco}"` : process.platform === 'darwin' ? `open "${endereco}"` : `xdg-open "${endereco}"`;
      exec(comando, (erro) => { if (erro) console.log(`Abra ${endereco} no navegador.`); });
    }
    const st = statusCatalogo(db);
    if (!st.materiais && !st.servicos) {
      console.log('[catalogo] índice vazio: baixando catálogos oficiais…');
      atualizarCatalogo(db).then((s) => console.log(`[catalogo] pronto: ${s.materiais} materiais (PDM), ${s.servicos} serviços`))
        .catch((e) => console.error('[catalogo] falhou:', e.message));
    }
  });
}
