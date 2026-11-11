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
  if (!n) return { n: 0, media: null, mediana: null, menor: null, maior: null, desvioPadrao: null, cv: null };
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
  };
}

/**
 * Critérios objetivos para desconsiderar valores inexequíveis ou excessivamente
 * elevados (art. 6º, § 3º e § 4º). Devolve, para cada posição, se fica e por quê.
 *
 * criterio:
 *   { tipo: 'nenhum' }
 *   { tipo: 'desvio', k: 1 }                         fora de média ± k·DP
 *   { tipo: 'iqr', k: 1.5 }                          fora de [Q1 − k·IQR, Q3 + k·IQR] (Tukey)
 *   { tipo: 'mediana', inferior: 0.5, superior: 0.5 } abaixo de mediana·(1−inf) ou acima de mediana·(1+sup)
 */
export function avaliarOutliers(valores, criterio = { tipo: 'nenhum' }) {
  const resultado = valores.map(() => ({ mantido: true, motivo: null }));
  if (valores.length < 3 || !criterio || criterio.tipo === 'nenhum') return resultado;

  let min = -Infinity;
  let max = Infinity;
  let rotulo = '';
  if (criterio.tipo === 'desvio') {
    const k = criterio.k ?? 1;
    const r = resumo(valores);
    min = r.media - k * r.desvioPadrao;
    max = r.media + k * r.desvioPadrao;
    rotulo = `média ± ${k} desvio(s) padrão`;
  } else if (criterio.tipo === 'iqr') {
    const k = criterio.k ?? 1.5;
    const o = ordenar(valores);
    const q1 = quartil(o, 0.25);
    const q3 = quartil(o, 0.75);
    min = q1 - k * (q3 - q1);
    max = q3 + k * (q3 - q1);
    rotulo = `intervalo interquartil (k = ${k})`;
  } else if (criterio.tipo === 'mediana') {
    const med = mediana(valores);
    const inf = criterio.inferior ?? 0.5;
    const sup = criterio.superior ?? 0.5;
    min = med * (1 - inf);
    max = med * (1 + sup);
    rotulo = `mediana −${Math.round(inf * 100)}% / +${Math.round(sup * 100)}%`;
  } else {
    return resultado;
  }

  valores.forEach((v, i) => {
    if (v < min) resultado[i] = { mantido: false, motivo: `inexequível: abaixo do limite (${rotulo})` };
    else if (v > max) resultado[i] = { mantido: false, motivo: `excessivamente elevado: acima do limite (${rotulo})` };
  });
  return resultado;
}

/**
 * Preço estimado pelo método escolhido (art. 6º, caput).
 * 'auto': média quando CV ≤ 25% (amostra homogênea), mediana caso contrário —
 * prática recorrente em orientações de controle externo.
 */
export function precoEstimado(valores, metodo = 'auto') {
  const r = resumo(valores);
  if (!r.n) return { metodo, metodoAplicado: null, valor: null, resumo: r, alertas: ['Nenhum preço válido na amostra.'] };

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
  return { metodo, metodoAplicado: aplicado, valor: arredondar(valor), resumo: r, alertas };
}

/**
 * Aplica exclusão automática + decisões manuais e calcula o preço do item.
 * amostras: [{ id, preco, manual: true|false|null }]  (manual null = segue o critério)
 */
export function analisarItem(amostras, { criterio, metodo, quantidade = 1 } = {}) {
  const precos = amostras.map((a) => a.preco);
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
  const total = estimativa.valor === null ? null : arredondar(estimativa.valor * quantidade);
  return { decisoes, estimativa, total };
}
