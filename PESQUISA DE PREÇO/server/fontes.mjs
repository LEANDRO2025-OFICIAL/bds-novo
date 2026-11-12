// Registro de fontes de preços e o contrato único que todas seguem.
//
// CONTRATO DE UMA FONTE
//   id         identificador curto e estável ('compras', 'pncp', 'bll'…)
//   nome       nome de exibição
//   modo       'direta'   → o sistema consulta a API pública da fonte (tem `buscar`)
//              'via-pncp' → o sistema NÃO consulta o portal; os preços dele chegam pelo que o portal publica
//                           no PNCP (Lei 14.133/2021, art. 174) e são reconhecidos pelo portal de origem
//   portal     id em server/portal-origem.mjs a que a fonte corresponde
//   buscaPor   o que a busca aceita: 'codigo' (catálogo CATMAT/CATSER) e/ou 'descricao' (palavras-chave)
//   estado     frase mostrada na interface dizendo, sem rodeios, o que está e o que não está implementado
//   verificado se as chamadas foram conferidas contra a API real e quando
//   buscar(db, filtros, opcoes) → Promise<ResultadoDaFonte>   (só no modo 'direta'; nas demais é null)
//
//   filtros            { tipo, codigoTipo, codigo, palavras, termoPncp, uf, inicio, fim }
//   ResultadoDaFonte   { registros: Amostra[], totalNaFonte, truncado, avisos: string[], cache, consultadoEm }
//   Amostra            formato normalizado de compras.mjs/pncp.mjs (origem, chaveOrigem, precoUnitario, dataCompra,
//                      orgao, uf, fornecedorNome, descricao, unidade, link…) + portalOrigem (sempre preenchido)
//
// PARA ACRESCENTAR UMA FONTE DIRETA: escreva o cliente (use obterJson de compras.mjs: cache, timeout, novas
// tentativas), normalize para Amostra e registre aqui com modo 'direta'. Só faça isso com documentação pública
// do endpoint em mãos — nada de endpoint presumido, raspagem de área logada ou contorno de captcha.
import { consultarPrecos } from './compras.mjs';
import { consultarPrecosPncp } from './pncp.mjs';
import { PORTAIS, PORTAIS_PRIVADOS, classificarPortal, nomePortal, portalValido } from './portal-origem.mjs';

export const ESTADO_VIA_PNCP = 'Preços obtidos via PNCP; consulta direta ao portal não implementada.';

const DIRETAS = [
  {
    id: 'compras',
    nome: 'Compras.gov.br',
    modo: 'direta',
    portal: 'comprasgov',
    buscaPor: ['codigo', 'descricao'],
    estado: 'Consulta direta à API de Dados Abertos do Compras.gov.br (módulo de pesquisa de preços), por código do catálogo; as palavras-chave refinam o resultado.',
    verificado: 'Contrato conferido com a API real em 10/2026 (ver server/compras.mjs).',
    buscar: (db, filtros, opcoes) => consultarPrecos(db, filtros, opcoes),
  },
  {
    id: 'pncp',
    nome: 'PNCP',
    modo: 'direta',
    portal: 'pncp',
    buscaPor: ['descricao'],
    estado: 'Consulta direta às APIs públicas do PNCP (busca do portal, itens e resultados homologados), por palavras-chave. Traz também as contratações que os portais privados publicam no PNCP.',
    verificado: 'Busca, itens e resultados conferidos com a API real em 17/10/2026. A leitura do portal de origem (campos linkSistemaOrigem e usuarioNome da contratação) NÃO foi conferida ao vivo.',
    // termoPncp: nome do código no catálogo, usado quando o usuário não digitou palavras-chave
    buscar: (db, filtros, opcoes) => consultarPrecosPncp(db, { ...filtros, palavras: filtros.palavras || filtros.termoPncp }, opcoes),
  },
];

const VIA_PNCP = PORTAIS.filter((p) => PORTAIS_PRIVADOS.includes(p.id)).map((p) => ({
  id: p.id,
  nome: p.nome,
  modo: 'via-pncp',
  portal: p.id,
  buscaPor: [],
  estado: ESTADO_VIA_PNCP,
  verificado: 'Nenhuma API deste portal foi consultada ou conferida. O reconhecimento depende dos domínios e nomes da tabela em server/portal-origem.mjs.',
  buscar: null,
}));

export const FONTES = [...DIRETAS, ...VIA_PNCP];
const POR_ID = new Map(FONTES.map((f) => [f.id, f]));

export const obterFonte = (id) => POR_ID.get(id) ?? null;
/** Ids das fontes que o sistema consulta de fato. */
export const idsDiretas = () => FONTES.filter((f) => f.modo === 'direta').map((f) => f.id);

/** Lista para a interface (sem funções). */
export function descreverFontes() {
  return FONTES.map(({ buscar, ...f }) => ({ ...f, portalNome: nomePortal(f.portal), consultaDireta: typeof buscar === 'function' }));
}

/**
 * Consulta uma fonte pelo contrato e confere a resposta: toda amostra sai com preço numérico e portalOrigem válido.
 * Fonte 'via-pncp' não tem consulta própria: o erro diz isso em vez de fingir uma resposta vazia.
 */
export async function buscarNaFonte(id, db, filtros, opcoes = {}) {
  const fonte = obterFonte(id);
  if (!fonte) throw new Error(`Fonte desconhecida: ${id}`);
  if (typeof fonte.buscar !== 'function') throw new Error(`${fonte.nome}: ${ESTADO_VIA_PNCP} Consulte o PNCP e filtre pelo portal de origem.`);
  const r = await fonte.buscar(db, filtros, opcoes);
  const registros = (r?.registros || []).filter((x) => Number.isFinite(x?.precoUnitario)).map((x) => (portalValido(x.portalOrigem) ? x
    : { ...x, portalOrigem: classificarPortal({ origem: x.origem, link: x.link, linkSistemaOrigem: x.linkSistemaOrigem, sistema: x.sistemaOrigem }) }));
  return {
    registros,
    totalNaFonte: r?.totalNaFonte ?? registros.length,
    truncado: Boolean(r?.truncado),
    avisos: r?.avisos || [],
    cache: r?.cache || null,
    consultadoEm: r?.consultadoEm || new Date().toISOString(),
  };
}
