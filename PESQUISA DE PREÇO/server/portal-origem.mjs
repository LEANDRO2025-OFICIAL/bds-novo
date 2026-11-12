// Portal de origem de um preço: em qual sistema a contratação foi realizada.
// Módulo puro (sem rede, sem banco). A classificação usa só o que a própria fonte informa:
//   1. o domínio do link do sistema de origem (no PNCP: campo linkSistemaOrigem da contratação);
//   2. o nome do sistema/usuário que publicou (no PNCP: campo usuarioNome);
//   3. a fonte consultada (preço vindo do Compras.gov.br é, por definição, do Compras.gov.br).
// Sem nenhuma dessas pistas o preço fica como "pncp" (publicado no PNCP, origem não identificável) ou "outro".
//
// PARA EDITAR: toda a tabela está em PORTAIS, logo abaixo. Para reconhecer um endereço novo, acrescente o
// domínio em `dominios` (subdomínios já são cobertos) ou uma expressão em `nomes`.
// Os domínios listados são os endereços públicos conhecidos de cada portal; a lista NÃO foi conferida ao vivo
// contra respostas reais do PNCP neste ambiente (rede bloqueada) — confira no relatório de cobertura da pesquisa.

export const PORTAIS = [
  {
    id: 'comprasgov',
    nome: 'Compras.gov.br',
    dominios: ['compras.gov.br', 'comprasnet.gov.br', 'comprasgovernamentais.gov.br', 'cnetmobile.estaleiro.serpro.gov.br'],
    nomes: [/compras\.?gov/, /comprasnet/, /compras governamentais/],
  },
  {
    id: 'portal-de-compras-publicas',
    nome: 'Portal de Compras Públicas',
    dominios: ['portaldecompraspublicas.com.br'],
    nomes: [/portal de compras publicas/, /portaldecompraspublicas/],
  },
  {
    id: 'bll',
    nome: 'BLL Compras',
    dominios: ['bll.org.br', 'bllcompras.com', 'bllcompras.org.br'],
    nomes: [/\bbll\b/, /bllcompras/, /bolsa de licitacoes/],
  },
  {
    id: 'bnc',
    nome: 'BNC — Bolsa Nacional de Compras',
    dominios: ['bnc.org.br', 'bnccompras.com'],
    nomes: [/\bbnc\b/, /bnccompras/, /bolsa nacional de compras/],
  },
  {
    id: 'licitanet',
    nome: 'Licitanet',
    dominios: ['licitanet.com.br'],
    nomes: [/licitanet/],
  },
  {
    id: 'licitar-digital',
    nome: 'Licitar Digital',
    dominios: ['licitardigital.com.br'],
    nomes: [/licitar ?digital/],
  },
  // Publicado no PNCP sem pista do sistema em que a disputa ocorreu.
  { id: 'pncp', nome: 'PNCP (origem não identificada)', dominios: ['pncp.gov.br'], nomes: [] },
  // Qualquer outro sistema, site ou cotação direta.
  { id: 'outro', nome: 'Outro / não se aplica', dominios: [], nomes: [] },
];

export const IDS_PORTAIS = PORTAIS.map((p) => p.id);
const POR_ID = new Map(PORTAIS.map((p) => [p.id, p]));
/** Portais privados cobertos apenas pelo que publicam no PNCP (sem consulta direta). */
export const PORTAIS_PRIVADOS = ['portal-de-compras-publicas', 'bll', 'bnc', 'licitanet', 'licitar-digital'];

/** Nome de exibição do portal (id desconhecido ou vazio → "—"). */
export const nomePortal = (id) => POR_ID.get(id)?.nome ?? '—';
export const portalValido = (id) => typeof id === 'string' && POR_ID.has(id);

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Host de uma URL http(s), em minúsculas e sem "www."; aceita endereço sem esquema. Malformada → null. */
export function hostDe(url) {
  const s = String(url ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(comEsquema);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** Portal cujo domínio é o host ou um sufixo dele ("x.bll.org.br" casa com "bll.org.br"; "falsobll.org.br" não). */
export function portalPorDominio(url) {
  const host = hostDe(url);
  if (!host) return null;
  return PORTAIS.find((p) => p.dominios.some((d) => host === d || host.endsWith(`.${d}`)))?.id ?? null;
}

/** Portal reconhecido pelo nome do sistema que publicou (sem acento, sem caixa). */
export function portalPorNome(nome) {
  const alvo = semAcento(nome).replace(/\s+/g, ' ').trim();
  if (!alvo) return null;
  return PORTAIS.find((p) => p.nomes.some((re) => re.test(alvo)))?.id ?? null;
}

/**
 * Classifica o portal de origem.
 *   linkSistemaOrigem — URL do sistema onde a contratação ocorreu (pista mais forte);
 *   sistema           — nome do sistema/usuário que publicou;
 *   link              — link público do registro (só usado se as pistas acima faltarem);
 *   origem            — fonte consultada: 'compras.gov.br', 'pncp' ou outra (cotação, importação…).
 * Devolve um id de PORTAIS. Link do próprio PNCP não identifica origem: o resultado é 'pncp'.
 */
export function classificarPortal({ linkSistemaOrigem = null, sistema = null, link = null, origem = null } = {}) {
  if (origem === 'compras.gov.br') return 'comprasgov';
  const pistas = [portalPorDominio(linkSistemaOrigem), portalPorNome(sistema), portalPorDominio(link)];
  const achado = pistas.find((p) => p && p !== 'pncp');
  if (achado) return achado;
  if (origem === 'pncp' || pistas.includes('pncp')) return 'pncp';
  return 'outro';
}

/**
 * Cobertura por portal: quantas amostras (e quantas consideradas no cálculo) vieram de cada portal.
 * Aceita amostras do banco (portal_origem) ou normalizadas (portalOrigem). Sempre devolve todos os portais,
 * na ordem da tabela, para que o zero também apareça — é a medida honesta de cobertura.
 */
export function coberturaPorPortal(amostras) {
  const conta = new Map(PORTAIS.map((p) => [p.id, { portal: p.id, nome: p.nome, amostras: 0, consideradas: 0 }]));
  for (const a of amostras) {
    const id = a.portal_origem ?? a.portalOrigem;
    const linha = conta.get(portalValido(id) ? id : classificarPortal({ link: a.link, origem: a.origem }));
    linha.amostras += 1;
    if (a.incluida) linha.consideradas += 1;
  }
  const porPortal = [...conta.values()];
  const total = amostras.length;
  const semOrigem = conta.get('pncp').amostras;
  const outros = conta.get('outro').amostras;
  return { total, identificadas: total - semOrigem - outros, semOrigem, outros, porPortal };
}
