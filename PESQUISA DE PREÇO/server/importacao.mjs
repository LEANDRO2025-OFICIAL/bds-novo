// Importação manual de preços: planilha CSV exportada pelo usuário de qualquer portal (rota de fuga para o que
// não tem consulta direta). Módulo puro: recebe o texto do arquivo e devolve amostras normalizadas + relatório
// linha a linha. Nada é gravado aqui — quem grava é a rota POST /api/itens/:id/importar.
import { createHash } from 'node:crypto';
import { lerCsv } from './csv.mjs';
import { PORTAIS, portalValido, nomePortal } from './portal-origem.mjs';

export const ORIGEM_IMPORTACAO = 'importacao-csv';
export const LIMITE_LINHAS = 1000;

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chaveCabecalho = (s) => semAcento(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Cabeçalhos aceitos para cada campo (sem acento, sem caixa, pontuação vira espaço). Edite aqui para aceitar outros. */
export const COLUNAS = {
  precoUnitario: ['preco unitario', 'valor unitario', 'preco unit', 'valor unit', 'vl unitario', 'vlr unitario', 'valor unitario homologado', 'preco unitario homologado', 'preco unitario r', 'valor unitario r', 'preco', 'valor'],
  dataCompra: ['data', 'data da compra', 'data compra', 'data do resultado', 'data resultado', 'data da homologacao', 'data homologacao', 'data da cotacao', 'data cotacao'],
  orgao: ['orgao', 'orgao entidade', 'entidade', 'comprador', 'unidade compradora', 'orgao comprador', 'promotor'],
  uf: ['uf', 'estado'],
  municipio: ['municipio', 'cidade'],
  fornecedorNome: ['fornecedor', 'razao social', 'nome do fornecedor', 'vencedor', 'fornecedor vencedor'],
  fornecedorNi: ['cnpj cpf', 'cpf cnpj', 'cnpj', 'cnpj do fornecedor', 'cnpj fornecedor', 'cpf', 'ni fornecedor'],
  marca: ['marca', 'marca modelo', 'marca fabricante'],
  descricao: ['descricao', 'descricao do item', 'descricao item', 'descricao detalhada', 'produto', 'especificacao'],
  unidade: ['unidade', 'unid', 'un', 'unidade de medida', 'unidade de fornecimento', 'unidade medida'],
  quantidade: ['quantidade', 'qtd', 'qtde', 'quant', 'quantidade homologada'],
  link: ['link', 'url', 'endereco', 'fonte', 'link da compra', 'link do processo'],
  objeto: ['objeto', 'objeto da compra', 'objeto da contratacao'],
  portal: ['portal de origem', 'portal', 'plataforma', 'sistema de origem'],
  registro: ['registro'], // CSV exportado por este sistema: só as linhas "Amostra" são importadas
  considerada: ['considerada'],
};
const CAMPO_POR_CABECALHO = new Map(Object.entries(COLUNAS).flatMap(([campo, nomes]) => nomes.map((n) => [n, campo])));

/**
 * Número em formato brasileiro ou internacional → { valor, ambiguo }.
 * "R$ 1.234,56" → 1234.56 · "1234,5" → 1234.5 · "1,234.56" → 1234.56 · "12.5" → 12.5
 * Só ponto com grupos de 3 dígitos ("1.250") é lido como milhar (padrão brasileiro) e marcado como ambíguo.
 */
export function lerNumero(texto) {
  let s = String(texto ?? '').trim().replace(/^r\$\s*/i, '').replace(/\s/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s) || !/\d/.test(s)) return { valor: null, ambiguo: false };
  const virgula = s.lastIndexOf(',');
  const ponto = s.lastIndexOf('.');
  let ambiguo = false;
  if (virgula >= 0 && ponto >= 0) s = virgula > ponto ? s.replaceAll('.', '').replace(',', '.') : s.replaceAll(',', '');
  else if (virgula >= 0) {
    if (s.indexOf(',') !== virgula) return { valor: null, ambiguo: false }; // "1,234,567": não é decimal brasileiro
    s = s.replace(',', '.');
  } else if (ponto >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) { s = s.replaceAll('.', ''); ambiguo = true; } else if (s.indexOf('.') !== ponto) return { valor: null, ambiguo: false };
  const valor = Number(s);
  return { valor: Number.isFinite(valor) ? valor : null, ambiguo };
}

/** Data dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa ou aaaa-mm-dd (com ou sem hora) → 'AAAA-MM-DD'; inválida → null. */
export function lerData(texto) {
  const s = String(texto ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  let a; let mes; let d;
  if (m) [, a, mes, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/))) [, d, mes, a] = m;
  else return null;
  const [an, me, di] = [Number(a), Number(mes), Number(d)];
  const dt = new Date(Date.UTC(an, me - 1, di));
  if (dt.getUTCFullYear() !== an || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== di || an < 1990) return null;
  return `${a}-${String(me).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
}

function lerLink(texto) {
  try {
    const u = new URL(String(texto).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Nome ou id de portal escrito na planilha → id conhecido, ou null. */
function portalDaCelula(texto) {
  const alvo = chaveCabecalho(texto);
  if (!alvo) return null;
  return PORTAIS.find((p) => p.id === String(texto).trim() || chaveCabecalho(p.nome) === alvo || chaveCabecalho(p.id) === alvo)?.id ?? null;
}

const cortar = (v, max) => (v ? String(v).trim().slice(0, max) || null : null);

/**
 * Lê o CSV e valida linha a linha.
 *   portal — id do portal de origem escolhido pelo usuário (vale para todas as linhas; uma coluna
 *            "Portal de origem" reconhecida na planilha tem precedência na própria linha).
 * Devolve {
 *   ok, erro (problema que impede ler o arquivo), portal, portalNome,
 *   colunas: [{ cabecalho, campo }] reconhecidas, ignoradas: [cabeçalhos sem uso],
 *   totalLinhas, validas: [{ linha, amostra, avisos }], rejeitadas: [{ linha, erros, conteudo }],
 *   repetidas: nº de linhas idênticas a outra já aceita no mesmo arquivo, puladas: nº de linhas que não são amostra
 * }. Linha com erro não entra; aviso não impede a entrada.
 */
export function importarCsv(texto, { portal, hoje = new Date() } = {}) {
  const base = { ok: false, erro: null, portal: portal ?? null, portalNome: nomePortal(portal), colunas: [], ignoradas: [], totalLinhas: 0, validas: [], rejeitadas: [], repetidas: 0, puladas: 0 };
  if (!portalValido(portal)) return { ...base, erro: 'Escolha o portal de origem dos preços.' };
  if (typeof texto !== 'string' || !texto.trim()) return { ...base, erro: 'O arquivo está vazio.' };
  if (texto.includes('\u0000') || texto.startsWith('PK')) return { ...base, erro: 'O arquivo não é um CSV de texto (parece uma planilha .xlsx/.xls). No Excel ou LibreOffice, use “Salvar como” → CSV e envie o arquivo gerado.' };

  const linhas = lerCsv(texto);
  if (linhas.length < 2) return { ...base, erro: 'O arquivo precisa ter a linha de cabeçalho e ao menos uma linha de preço.' };
  const cabecalho = linhas[0];
  const indice = {};
  cabecalho.forEach((nome, i) => {
    const campo = CAMPO_POR_CABECALHO.get(chaveCabecalho(nome));
    if (campo && !(campo in indice)) { indice[campo] = i; base.colunas.push({ cabecalho: nome, campo }); } else if (nome) base.ignoradas.push(nome);
  });
  if (!('precoUnitario' in indice)) {
    return { ...base, erro: `Não encontrei a coluna de preço unitário. Cabeçalhos lidos: ${cabecalho.filter(Boolean).join(' | ').slice(0, 400)}. Nomeie a coluna como “Preço unitário” ou “Valor unitário”.` };
  }
  const dados = linhas.slice(1);
  base.totalLinhas = dados.length;
  if (dados.length > LIMITE_LINHAS) return { ...base, erro: `O arquivo tem ${dados.length} linhas de dados; o máximo por importação é ${LIMITE_LINHAS}. Divida o arquivo.` };

  const hojeIso = hoje.toISOString().slice(0, 10);
  const vistas = new Set();
  for (const l of dados) {
    const cel = (campo) => (campo in indice ? (l[indice[campo]] ?? '').trim() : '');
    if ('registro' in indice && chaveCabecalho(cel('registro')) !== 'amostra') { base.puladas += 1; continue; } // linhas RESUMO/total do nosso CSV
    const erros = [];
    const avisos = [];

    const preco = lerNumero(cel('precoUnitario'));
    if (cel('precoUnitario') === '') erros.push('Preço unitário em branco.');
    else if (preco.valor === null) erros.push(`Preço unitário ilegível: “${cel('precoUnitario').slice(0, 40)}”.`);
    else if (preco.valor <= 0) erros.push('Preço unitário deve ser maior que zero.');
    else if (preco.ambiguo) avisos.push(`Preço “${cel('precoUnitario')}” lido como ${preco.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (ponto como separador de milhar). Confira.`);

    let dataCompra = null;
    if (cel('dataCompra')) {
      dataCompra = lerData(cel('dataCompra'));
      if (!dataCompra) erros.push(`Data inválida: “${cel('dataCompra').slice(0, 30)}” (use DD/MM/AAAA).`);
      else if (dataCompra > hojeIso) erros.push(`Data no futuro: ${cel('dataCompra')}.`);
    } else if ('dataCompra' in indice) avisos.push('Sem data: a amostra entra sem data da compra.');

    let quantidade = null;
    if (cel('quantidade')) {
      const q = lerNumero(cel('quantidade'));
      if (q.valor === null || q.valor <= 0) erros.push(`Quantidade inválida: “${cel('quantidade').slice(0, 30)}”.`);
      else quantidade = q.valor;
    }

    let uf = null;
    if (cel('uf')) {
      if (/^[A-Za-z]{2}$/.test(cel('uf'))) uf = cel('uf').toUpperCase();
      else erros.push(`UF inválida: “${cel('uf').slice(0, 20)}” (use a sigla, ex.: MS).`);
    }

    let link = null;
    if (cel('link')) {
      link = lerLink(cel('link'));
      if (!link) avisos.push('Link ignorado (não é um endereço http/https).');
    }

    let portalLinha = portal;
    if (cel('portal')) {
      const p = portalDaCelula(cel('portal'));
      if (p) portalLinha = p;
      else avisos.push(`Portal “${cel('portal').slice(0, 40)}” não reconhecido; usado o portal escolhido (${nomePortal(portal)}).`);
    }

    if (erros.length) {
      base.rejeitadas.push({ linha: l.numero, erros, conteudo: l.filter(Boolean).join(' | ').slice(0, 160) });
      continue;
    }
    const amostra = {
      origem: ORIGEM_IMPORTACAO,
      portalOrigem: portalLinha,
      dataCompra,
      orgao: cortar(cel('orgao'), 500),
      uf,
      municipio: cortar(cel('municipio'), 120),
      fornecedorNi: cortar(cel('fornecedorNi').replace(/[^\dA-Za-z]/g, ''), 20),
      fornecedorNome: cortar(cel('fornecedorNome'), 300),
      marca: cortar(cel('marca'), 200),
      descricao: cortar(cel('descricao'), 4000),
      unidade: cortar(cel('unidade'), 60),
      quantidade,
      precoUnitario: preco.valor,
      objeto: cortar(cel('objeto'), 2000),
      link,
    };
    // Chave estável pelo conteúdo: reimportar o mesmo arquivo não duplica amostras.
    const impressao = [amostra.portalOrigem, amostra.dataCompra, amostra.orgao, amostra.uf, amostra.municipio, amostra.fornecedorNi, amostra.fornecedorNome, amostra.marca, amostra.descricao, amostra.unidade, amostra.quantidade, amostra.precoUnitario, amostra.link].join('\u001f');
    amostra.chaveOrigem = `importado-${createHash('sha256').update(impressao).digest('hex').slice(0, 24)}`;
    if (vistas.has(amostra.chaveOrigem)) { base.repetidas += 1; continue; }
    vistas.add(amostra.chaveOrigem);
    base.validas.push({ linha: l.numero, amostra, avisos });
  }
  return { ...base, ok: true };
}
