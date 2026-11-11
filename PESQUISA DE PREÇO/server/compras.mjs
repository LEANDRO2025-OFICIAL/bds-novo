// Cliente da API pública "Dados Abertos Compras.gov.br" (módulos material, serviço e pesquisa de preço).
// Contrato oficial: https://dadosabertos.compras.gov.br/v3/api-docs
// Educado com o servidor: cache local de 24 h, 1 requisição por vez, novas tentativas com espera.

export const BASE = 'https://dadosabertos.compras.gov.br';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 60_000;
const TENTATIVAS = 3;
export const PAGINA_MAX = 500; // limite do contrato (tamanhoPagina ≤ 500)
export const LIMITE_REGISTROS = 2000; // 4 páginas por consulta de preço

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class ErroApi extends Error {
  constructor(mensagem, { status = null, url = null } = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.url = url;
  }
}

/** Fila com limite de chamadas simultâneas: devolve enfileirar(fn) → Promise do resultado de fn. */
export function criarFila(max = 1) {
  let ativos = 0;
  const espera = [];
  const proximo = () => {
    if (ativos >= max || !espera.length) return;
    ativos++;
    const { fn, ok, falha } = espera.shift();
    Promise.resolve().then(fn).then(ok, falha).finally(() => { ativos--; proximo(); });
  };
  return (fn) => new Promise((ok, falha) => { espera.push({ fn, ok, falha }); proximo(); });
}

// Compras.gov.br: uma chamada externa por vez.
const enfileirar = criarFila(1);

export function montarUrl(caminho, params) {
  const u = new URL(caminho, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * GET JSON com cache, timeout e novas tentativas. fetchImpl injetável para testes.
 * fila/fonte permitem reusar o cliente para outro portal (ex.: PNCP). Corpo vazio (HTTP 204) vira null.
 */
export async function obterJson(db, url, { fetchImpl = fetch, semCache = false, fila = enfileirar, fonte = 'Compras.gov.br' } = {}) {
  const ler = (texto) => (texto ? JSON.parse(texto) : null);
  if (db && !semCache) {
    const linha = db.prepare('SELECT corpo, criado_em FROM cache WHERE chave = ?').get(url);
    if (linha && Date.now() - linha.criado_em < CACHE_TTL_MS) return ler(linha.corpo);
  }
  const corpo = await fila(async () => {
    let ultimoErro;
    for (let t = 1; t <= TENTATIVAS; t++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
        const texto = await res.text();
        if (res.ok) return texto;
        let detalhe = texto.slice(0, 300);
        try { detalhe = JSON.parse(texto).detail || detalhe; } catch { /* corpo não-JSON */ }
        ultimoErro = new ErroApi(`${fonte} respondeu ${res.status}: ${detalhe}`, { status: res.status, url });
        if (res.status < 500 && res.status !== 429) break; // erro do pedido: não adianta repetir
      } catch (e) {
        ultimoErro = new ErroApi(e.name === 'AbortError' ? `Tempo esgotado (${TIMEOUT_MS / 1000}s) ao consultar ${fonte}` : `Falha de rede (${fonte}): ${e.message}`, { url });
      } finally {
        clearTimeout(timer);
      }
      if (t < TENTATIVAS) await dormir(800 * 2 ** (t - 1));
    }
    throw ultimoErro;
  });
  const json = ler(corpo);
  if (db) db.prepare('INSERT INTO cache (chave, corpo, criado_em) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET corpo = excluded.corpo, criado_em = excluded.criado_em').run(url, corpo, Date.now());
  return json;
}

/** Link público da compra no Compras.gov.br a partir do idCompra (UASG+modalidade+número+ano). */
export function linkCompra(idCompra) {
  return idCompra ? `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${idCompra}` : null;
}

const ESFERA = { F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' };

/** Converte um registro da API (material ou serviço) para o formato interno de amostra. */
export function normalizarRegistro(r) {
  const unidade = r.siglaUnidadeFornecimento || r.nomeUnidadeFornecimento || r.siglaUnidadeMedida || r.nomeUnidadeMedida || null;
  return {
    origem: 'compras.gov.br',
    chaveOrigem: String(r.idCompraItem || `${r.idCompra}-${r.numeroItemCompra}`),
    dataCompra: r.dataResultado || r.dataCompra || null,
    orgao: [r.nomeOrgao, r.nomeUasg].filter(Boolean).join(' — ') || null,
    uasg: r.codigoUasg ?? null,
    uf: r.estado ?? null,
    municipio: r.municipio ?? null,
    esfera: ESFERA[r.esfera] ?? r.esfera ?? null,
    fornecedorNi: r.niFornecedor ?? null,
    fornecedorNome: r.nomeFornecedor ?? null,
    marca: r.marca ?? null,
    descricao: r.descricaoDetalhadaItem || r.descricaoItem || null,
    unidade,
    quantidade: r.quantidade ?? null,
    precoUnitario: Number(r.precoUnitario),
    objeto: r.objetoCompra ?? null,
    modalidade: r.modalidade ?? null,
    forma: r.forma ?? null,
    codigoItemCatalogo: r.codigoItemCatalogo ?? null,
    link: linkCompra(r.idCompra),
  };
}

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Filtro local por palavras: todas devem aparecer na descrição (sem acento, sem caixa). */
export function filtrarPorPalavras(registros, palavras) {
  const termos = semAcento(palavras).split(/\s+/).filter(Boolean);
  if (!termos.length) return registros;
  return registros.filter((r) => {
    const alvo = semAcento(`${r.descricao} ${r.marca || ''}`);
    return termos.every((t) => alvo.includes(t));
  });
}

/**
 * Consulta preços praticados. tipo: 'material' | 'servico'; codigoTipo: 'pdm' | 'item' | 'servico'.
 * Pagina até LIMITE_REGISTROS e devolve registros normalizados, válidos (preço > 0).
 */
export async function consultarPrecos(db, { tipo, codigoTipo, codigo, uf, inicio, fim, palavras }, opts = {}) {
  if (!codigo) throw new ErroApi('Informe o código do catálogo.');
  let caminho;
  const base = { tamanhoPagina: PAGINA_MAX, estado: uf || undefined, dataCompraInicio: inicio, dataCompraFim: fim };
  if (tipo === 'servico') {
    caminho = '/modulo-pesquisa-preco/3_consultarServico';
    base.codigoItemCatalogo = codigo;
  } else {
    caminho = '/modulo-pesquisa-preco/1_consultarMaterial';
    base.tipo = codigoTipo === 'item' ? 'codigoItemCatalogo' : 'codigoPdm';
    base.codigo = codigo;
  }

  const brutos = [];
  let total = 0;
  for (let pagina = 1; ; pagina++) {
    const json = await obterJson(db, montarUrl(caminho, { ...base, pagina }), opts);
    total = json.totalRegistros ?? 0;
    brutos.push(...(json.resultado || []));
    if (!json.paginasRestantes || brutos.length >= LIMITE_REGISTROS) break;
  }
  let registros = brutos.map(normalizarRegistro).filter((r) => Number.isFinite(r.precoUnitario) && r.precoUnitario > 0);
  registros = filtrarPorPalavras(registros, palavras);
  registros.sort((a, b) => String(b.dataCompra).localeCompare(String(a.dataCompra)));
  return { registros, totalNaFonte: total, truncado: total > brutos.length, consultadoEm: new Date().toISOString() };
}
