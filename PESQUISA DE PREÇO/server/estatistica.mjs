// Regras de cálculo da pesquisa de preços (IN SEGES/ME 65/2021, art. 6º).
// Funções puras: recebem números, devolvem números. Sem I/O.

export const MINIMO_AMOSTRAS = 3; // art. 6º, § 5º (regra geral)

export function arredondar(valor, casas = 2) {
  const f = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * f) / f;
}

function ordenar(valores) {
  return [...valores].sort((a, b) => a - b);
}

export function mediana(valores) {
  if (!valores.length) return null;
  const v = ordenar(valores);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function quartil(ordenados, p) {
  // Interpolação linear (método 7 de Hyndman & Fan, o mesmo do Excel QUARTIL.INC)
  const pos = (ordenados.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const prox = ordenados[base + 1];
  return prox === undefined ? ordenados[base] : ordenados[base] + resto * (prox - ordenados[base]);
}

/** Estatística descritiva. Desvio padrão AMOSTRAL (n-1), como DESVPAD.A do Excel. */
export function resumo(valores) {
  const n = valores.length;
  if (!n) return { n: 0, media: null, mediana: null, menor: null, maior: null, desvioPadrao: null, cv: null, q1: null, q3: null, iqr: null };
  const media = valores.reduce((s, x) => s + x, 0) / n;
  const variancia = n > 1 ? valores.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1) : 0;
  const desvioPadrao = Math.sqrt(variancia);
  return {
    n,
    media,
    mediana: mediana(valores),
    menor: Math.min(...valores),
    maior: Math.max(...valores),
    desvioPadrao,
    cv: media > 0 ? desvioPadrao / media : null,
    ...quartis(valores),
  };
}

/** Quartis por interpolação linear (QUARTIL.INC) e amplitude interquartil. */
export function quartis(valores) {
  if (!valores.length) return { q1: null, q3: null, iqr: null };
  const o = ordenar(valores);
  const q1 = quartil(o, 0.25);
  const q3 = quartil(o, 0.75);
  return { q1, q3, iqr: q3 - q1 };
}

export const CRITERIOS = ['nenhum', 'desvio', 'iqr', 'mediana'];
const numeroOu = (v, padrao) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : padrao);
const fmt = (n) => String(n).replace('.', ',');

/**
 * Limites [min, max] do critério objetivo de exclusão (art. 6º, § 3º e § 4º).
 *
 * criterio:
 *   { tipo: 'nenhum' }
 *   { tipo: 'desvio', k: 1 }                         escore z: fora de média ± k·DP (DP amostral)
 *   { tipo: 'iqr', k: 1.5 }                          fora de [Q1 − k·IQR, Q3 + k·IQR] (Tukey)
 *   { tipo: 'mediana', inferior: 0.5, superior: 0.5 } abaixo de mediana·(1−inf) ou acima de mediana·(1+sup)
 *
 * aplicavel = false (com nota) quando o critério não tem como distinguir valores:
 * menos de 3 preços, dispersão nula (todos iguais) ou amplitude interquartil zero.
 */
export function limitesCriterio(valores, criterio = { tipo: 'nenhum' }) {
  const fora = (nota) => ({ aplicavel: false, min: null, max: null, rotulo: '', nota });
  const tipo = criterio?.tipo ?? 'nenhum';
  if (tipo === 'nenhum' || !CRITERIOS.includes(tipo)) return fora(null);
  if (valores.length < MINIMO_AMOSTRAS) return fora(`Critério não aplicado: são necessários ao menos ${MINIMO_AMOSTRAS} preços.`);

  if (tipo === 'desvio') {
    const k = numeroOu(criterio.k, 1);
    const r = resumo(valores);
    // Dispersão nula (ou só ruído de ponto flutuante): não há valor discrepante a apontar.
    if (r.desvioPadrao <= Math.abs(r.media) * 1e-12) return fora('Critério não aplicado: todos os preços são iguais (desvio padrão zero).');
    return { aplicavel: true, min: r.media - k * r.desvioPadrao, max: r.media + k * r.desvioPadrao, rotulo: `média ± ${fmt(k)} desvio(s) padrão`, nota: null };
  }
  if (tipo === 'iqr') {
    const k = numeroOu(criterio.k, 1.5);
    const { q1, q3, iqr } = quartis(valores);
    // IQR zero: a cerca colapsaria em [Q1, Q3] e excluiria qualquer valor diferente da maioria.
    if (iqr <= Math.abs(q3) * 1e-12) return fora('Critério não aplicado: amplitude interquartil igual a zero (metade central dos preços é idêntica). Use outro método ou exclua manualmente com justificativa.');
    return { aplicavel: true, min: q1 - k * iqr, max: q3 + k * iqr, rotulo: `amplitude interquartil (${fmt(k)} × IQR)`, nota: null };
  }
  const med = mediana(valores);
  const inf = numeroOu(criterio.inferior, 0.5);
  const sup = numeroOu(criterio.superior, 0.5);
  return { aplicavel: true, min: med * (1 - inf), max: med * (1 + sup), rotulo: `mediana −${Math.round(inf * 100)}% / +${Math.round(sup * 100)}%`, nota: null };
}

/** Para cada posição: se o preço fica na amostra e, se não, por quê. */
export function avaliarOutliers(valores, criterio = { tipo: 'nenhum' }) {
  const resultado = valores.map(() => ({ mantido: true, motivo: null }));
  const lim = limitesCriterio(valores, criterio);
  if (!lim.aplicavel) return resultado;
  // Tolerância relativa: um preço igual ao limite (a menos de erro de ponto flutuante) permanece.
  const tol = (x) => Math.abs(x) * 1e-9;
  valores.forEach((v, i) => {
    if (v < lim.min - tol(lim.min)) resultado[i] = { mantido: false, motivo: `inexequível: abaixo do limite (${lim.rotulo})` };
    else if (v > lim.max + tol(lim.max)) resultado[i] = { mantido: false, motivo: `excessivamente elevado: acima do limite (${lim.rotulo})` };
  });
  return resultado;
}

/**
 * Preço estimado pelo método escolhido (art. 6º, caput).
 * Devolve também as três opções (média, mediana, menor) para comparação e `insuficiente` (< 3 preços válidos).
 * 'auto': média quando CV ≤ 25% (amostra homogênea), mediana caso contrário —
 * prática recorrente em orientações de controle externo.
 */
export function precoEstimado(valores, metodo = 'auto') {
  const r = resumo(valores);
  if (!r.n) return { metodo, metodoAplicado: null, valor: null, opcoes: { media: null, mediana: null, menor: null }, insuficiente: true, resumo: r, alertas: ['Nenhum preço válido na amostra.'] };

  let aplicado = metodo;
  if (metodo === 'auto') aplicado = r.cv !== null && r.cv <= 0.25 ? 'media' : 'mediana';
  const valor = aplicado === 'media' ? r.media : aplicado === 'menor' ? r.menor : r.mediana;

  const alertas = [];
  if (r.n < MINIMO_AMOSTRAS) {
    alertas.push(`Amostra com ${r.n} preço(s); a regra geral exige no mínimo ${MINIMO_AMOSTRAS} (art. 6º, § 5º). Justifique no processo.`);
  }
  if (r.cv !== null && r.cv > 0.25) {
    const cvTexto = arredondar(r.cv * 100, 1).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    alertas.push(`Coeficiente de variação de ${cvTexto}%: amostra heterogênea; analise criticamente (art. 6º, § 3º).`);
  }
  const opcoes = { media: arredondar(r.media), mediana: arredondar(r.mediana), menor: arredondar(r.menor) };
  return { metodo, metodoAplicado: aplicado, valor: arredondar(valor), opcoes, insuficiente: r.n < MINIMO_AMOSTRAS, resumo: r, alertas };
}

/**
 * Aplica exclusão automática + decisões manuais e calcula o preço do item.
 * amostras: [{ id, preco, manual: true|false|null }]  (manual null = segue o critério)
 */
export function analisarItem(amostras, { criterio, metodo, quantidade = 1 } = {}) {
  const precos = amostras.map((a) => a.preco);
  const limites = limitesCriterio(precos, criterio);
  const avaliacao = avaliarOutliers(precos, criterio);
  const decisoes = amostras.map((a, i) => {
    const automatico = avaliacao[i];
    const incluida = a.manual === true ? true : a.manual === false ? false : automatico.mantido;
    let motivo = null;
    if (a.manual === false) motivo = 'excluída manualmente';
    else if (a.manual === true && !automatico.mantido) motivo = 'mantida manualmente apesar do critério';
    else if (!incluida) motivo = automatico.motivo;
    return { id: a.id, preco: a.preco, incluida, motivo };
  });
  const validos = decisoes.filter((d) => d.incluida).map((d) => d.preco);
  const estimativa = precoEstimado(validos, metodo);
  if (limites.nota) estimativa.alertas.push(limites.nota);
  const total = estimativa.valor === null ? null : arredondar(estimativa.valor * quantidade);
  return { decisoes, estimativa, total, limites, validas: validos.length, excluidas: decisoes.length - validos.length };
}
