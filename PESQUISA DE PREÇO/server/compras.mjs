// Cliente da API pública "Dados Abertos Compras.gov.br" (módulos material, serviço e pesquisa de preço).
// Contrato oficial: https://dadosabertos.compras.gov.br/v3/api-docs
// Educado com o servidor: cache local de 24 h, 1 requisição por vez, novas tentativas com espera crescente.
// Resiliente: se a fonte não responder depois das tentativas, devolve a última resposta guardada (mesmo vencida).

export const BASE = 'https://dadosabertos.compras.gov.br';
const envNumero = (nome, padrao) => { const n = Number(process.env[nome]); return Number.isFinite(n) && n > 0 ? n : padrao; };
const CACHE_TTL_MS = envNumero('CACHE_TTL_HORAS', 24) * 60 * 60 * 1000;
/** Padrões de rede (ajustáveis por variável de ambiente; cada chamada pode sobrepor via opções). */
export const REDE = {
  tentativas: Math.round(envNumero('API_TENTATIVAS', 4)),
  timeoutMs: envNumero('API_TIMEOUT_MS', 45_000), // por tentativa
  baseMs: envNumero('API_ESPERA_BASE_MS', 800),
  tetoMs: 20_000,
};
export const PAGINA_MAX = 500; // limite do contrato (tamanhoPagina ≤ 500)
export const LIMITE_REGISTROS = 2000; // 4 páginas por consulta de preço

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera antes da próxima tentativa: exponencial (base · 2^(n−1), limitada ao teto) com jitter —
 * metade fixa + metade aleatória, para que clientes simultâneos não voltem todos no mesmo instante.
 * Se o servidor mandou Retry-After, espera ao menos isso (até o teto).
 */
export function esperaBackoff(tentativa, { baseMs = REDE.baseMs, tetoMs = REDE.tetoMs, aleatorio = Math.random, retryAfterMs = null } = {}) {
  const exponencial = Math.min(tetoMs, baseMs * 2 ** (tentativa - 1));
  const comJitter = exponencial / 2 + aleatorio() * (exponencial / 2);
  const pedido = retryAfterMs === null ? 0 : Math.min(retryAfterMs, tetoMs);
  return Math.round(Math.max(comJitter, pedido));
}

/** Cabeçalho Retry-After (segundos ou data HTTP) → milissegundos, ou null. */
export function lerRetryAfter(valor, agora = Date.now()) {
  if (valor === null || valor === undefined || valor === '') return null;
  const seg = Number(valor);
  if (Number.isFinite(seg)) return Math.max(0, seg * 1000);
  const data = Date.parse(valor);
  return Number.isNaN(data) ? null : Math.max(0, data - agora);
}

/** Repetir só o que pode melhorar sozinho: 408, 425, 429 e 5xx. Os demais 4xx são erro do pedido. */
export const statusRepetivel = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * Rastro de uma consulta: quantas respostas vieram da rede, do cache válido e do cache vencido (fonte fora do ar).
 * resumo() → { usado, total, obsoleto, de (ISO da resposta em cache mais antiga), motivo }.
 */
export function criarRastro() {
  const r = { rede: 0, cache: 0, vencido: 0, maisAntigo: null, motivo: null };
  return {
    registrar(origem, criadoEm = null, motivo = null) {
      r[origem] += 1;
      if (criadoEm !== null && (r.maisAntigo === null || criadoEm < r.maisAntigo)) r.maisAntigo = criadoEm;
      if (motivo && !r.motivo) r.motivo = motivo;
    },
    resumo() {
      const doCache = r.cache + r.vencido;
      return {
        usado: doCache > 0,
        total: doCache > 0 && r.rede === 0,
        obsoleto: r.vencido > 0,
        de: r.maisAntigo === null ? null : new Date(r.maisAntigo).toISOString(),
        motivo: r.motivo,
      };
    },
  };
}

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
 * GET JSON com cache, timeout por tentativa e novas tentativas com backoff exponencial + jitter.
 * - repete em falha de rede, timeout, 408/425/429 e 5xx (respeitando Retry-After); não repete nos demais 4xx;
 * - se todas as tentativas falharem e houver resposta guardada (mesmo vencida), devolve a guardada e
 *   anota no `rastro` — a interface mostra "resultado do cache de DD/MM";
 * - fetchImpl, dormirImpl e aleatorio são injetáveis para testes; fila/fonte permitem reusar o cliente
 *   em outro portal (ex.: PNCP). Corpo vazio (HTTP 204) vira null.
 */
export async function obterJson(db, url, opcoes = {}) {
  const {
    fetchImpl = fetch, semCache = false, fila = enfileirar, fonte = 'Compras.gov.br', rastro = null,
    tentativas = REDE.tentativas, timeoutMs = REDE.timeoutMs, baseMs = REDE.baseMs, tetoMs = REDE.tetoMs,
    dormirImpl = dormir, aleatorio = Math.random,
  } = opcoes;
  const ler = (texto) => (texto ? JSON.parse(texto) : null);
  const guardado = db ? db.prepare('SELECT corpo, criado_em FROM cache WHERE chave = ?').get(url) : null;
  if (guardado && !semCache && Date.now() - guardado.criado_em < CACHE_TTL_MS) {
    rastro?.registrar('cache', guardado.criado_em);
    return ler(guardado.corpo);
  }

  let corpo;
  try {
    corpo = await fila(async () => {
      let ultimoErro;
      for (let t = 1; t <= tentativas; t++) {
        const ctl = new AbortController();
        let timer;
        let retryAfterMs = null;
        try {
          // A corrida garante o limite mesmo se o fetch ignorar o sinal de aborto; o limite cobre também a leitura do corpo.
          const resposta = await Promise.race([
            (async () => {
              const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
              return { res, texto: await res.text() };
            })(),
            new Promise((_, rejeitar) => {
              timer = setTimeout(() => { ctl.abort(); rejeitar(Object.assign(new Error('tempo esgotado'), { name: 'TimeoutError' })); }, timeoutMs);
            }),
          ]);
          const { res, texto } = resposta;
          if (res.ok) {
            ler(texto); // resposta 200 com corpo inválido (página de erro de proxy) conta como falha e é repetida
            return texto;
          }
          let detalhe = texto.slice(0, 300);
          try { const j = JSON.parse(texto); detalhe = j.detail || j.message || detalhe; } catch { /* corpo não-JSON */ }
          ultimoErro = new ErroApi(`${fonte} respondeu ${res.status}: ${detalhe}`, { status: res.status, url });
          if (!statusRepetivel(res.status)) break; // erro do pedido: não adianta repetir
          retryAfterMs = lerRetryAfter(res.headers?.get?.('retry-after'));
        } catch (e) {
          const esgotou = e.name === 'TimeoutError' || e.name === 'AbortError';
          ultimoErro = new ErroApi(
            esgotou ? `Tempo esgotado (${String(Math.round(timeoutMs / 100) / 10).replace('.', ',')} s) ao consultar ${fonte}`
              : e instanceof SyntaxError ? `${fonte} devolveu uma resposta ilegível`
                : `Falha de rede (${fonte}): ${e.cause?.code || e.message}`,
            { url },
          );
        } finally {
          clearTimeout(timer);
        }
        if (t < tentativas) await dormirImpl(esperaBackoff(t, { baseMs, tetoMs, aleatorio, retryAfterMs }));
      }
      ultimoErro.tentativas = tentativas;
      throw ultimoErro;
    });
  } catch (e) {
    // Fonte fora do ar: melhor um resultado antigo e identificado do que nenhum. Erro do pedido (4xx) não usa cache.
    const erroDoPedido = e instanceof ErroApi && e.status !== null && !statusRepetivel(e.status);
    if (guardado && !erroDoPedido) {
      rastro?.registrar('vencido', guardado.criado_em, e.message);
      return ler(guardado.corpo);
    }
    throw e;
  }
  if (db) db.prepare('INSERT INTO cache (chave, corpo, criado_em) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET corpo = excluded.corpo, criado_em = excluded.criado_em').run(url, corpo, Date.now());
  rastro?.registrar('rede');
  return ler(corpo);
}

/** Apaga respostas guardadas há mais de `dias` (padrão 30): o cache serve de reserva, não de arquivo. */
export function limparCacheAntigo(db, dias = envNumero('CACHE_RETENCAO_DIAS', 30)) {
  return Number(db.prepare('DELETE FROM cache WHERE criado_em < ?').run(Date.now() - dias * 24 * 60 * 60 * 1000).changes);
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
    portalOrigem: 'comprasgov',
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
  const rastro = opts.rastro || criarRastro();
  for (let pagina = 1; ; pagina++) {
    const json = await obterJson(db, montarUrl(caminho, { ...base, pagina }), { ...opts, rastro });
    total = json?.totalRegistros ?? 0;
    brutos.push(...(json?.resultado || []));
    if (!json?.paginasRestantes || brutos.length >= LIMITE_REGISTROS) break;
  }
  let registros = brutos.map(normalizarRegistro).filter((r) => Number.isFinite(r.precoUnitario) && r.precoUnitario > 0);
  registros = filtrarPorPalavras(registros, palavras);
  registros.sort((a, b) => String(b.dataCompra).localeCompare(String(a.dataCompra)));
  return { registros, totalNaFonte: total, truncado: total > brutos.length, cache: rastro.resumo(), consultadoEm: new Date().toISOString() };
}
