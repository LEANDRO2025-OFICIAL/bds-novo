import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resumo, mediana, quartis, limitesCriterio, avaliarOutliers, precoEstimado, analisarItem, arredondar } from '../server/estatistica.mjs';

const perto = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

describe('estatística descritiva', () => {
  test('média, mediana, extremos, desvio padrão amostral e CV (conferidos com Excel)', () => {
    const r = resumo([10, 12, 14, 16, 18]);
    assert.equal(r.n, 5);
    assert.equal(r.media, 14);
    assert.equal(r.mediana, 14);
    assert.equal(r.menor, 10);
    assert.equal(r.maior, 18);
    perto(r.desvioPadrao, Math.sqrt(10)); // DESVPAD.A = 3,1623
    perto(r.cv, Math.sqrt(10) / 14);
  });
  test('mediana com quantidade par e lista desordenada', () => {
    assert.equal(mediana([9, 1, 4, 3]), 3.5);
  });
  test('amostra vazia e unitária', () => {
    assert.equal(resumo([]).media, null);
    const um = resumo([7]);
    assert.equal(um.desvioPadrao, 0);
    assert.equal(um.cv, 0);
  });
  test('arredondamento meio-para-cima sem erro de ponto flutuante', () => {
    assert.equal(arredondar(1.005), 1.01);
    assert.equal(arredondar(2.675), 2.68);
  });
});

describe('critérios de exclusão (art. 6º, § 3º)', () => {
  const valores = [10, 11, 12, 13, 100];
  test('nenhum mantém tudo', () => {
    assert.ok(avaliarOutliers(valores, { tipo: 'nenhum' }).every((x) => x.mantido));
  });
  test('desvio padrão marca o excessivo', () => {
    const r = avaliarOutliers(valores, { tipo: 'desvio', k: 1 });
    assert.deepEqual(r.map((x) => x.mantido), [true, true, true, true, false]);
    assert.match(r[4].motivo, /excessivamente elevado/);
  });
  test('IQR (Tukey) marca o excessivo', () => {
    const r = avaliarOutliers(valores, { tipo: 'iqr', k: 1.5 });
    assert.equal(r[4].mantido, false);
    assert.ok(r.slice(0, 4).every((x) => x.mantido));
  });
  test('percentual da mediana marca inexequível e excessivo', () => {
    const r = avaliarOutliers([2, 10, 10, 11, 30], { tipo: 'mediana', inferior: 0.5, superior: 0.5 });
    assert.match(r[0].motivo, /inexequível/);
    assert.match(r[4].motivo, /excessivamente elevado/);
    assert.ok(r.slice(1, 4).every((x) => x.mantido));
  });
  test('com menos de 3 valores não exclui nada', () => {
    assert.ok(avaliarOutliers([1, 1000], { tipo: 'desvio', k: 1 }).every((x) => x.mantido));
  });
});

describe('preço estimado (art. 6º, caput)', () => {
  test('auto escolhe média em amostra homogênea (CV ≤ 25%)', () => {
    const e = precoEstimado([100, 102, 98, 101], 'auto');
    assert.equal(e.metodoAplicado, 'media');
    assert.equal(e.valor, 100.25);
    assert.deepEqual(e.alertas, []);
  });
  test('auto escolhe mediana em amostra heterogênea e alerta', () => {
    const e = precoEstimado([10, 20, 60], 'auto');
    assert.equal(e.metodoAplicado, 'mediana');
    assert.equal(e.valor, 20);
    assert.ok(e.alertas.some((a) => /heterogênea/.test(a)));
  });
  test('menor preço e alerta de amostra insuficiente', () => {
    const e = precoEstimado([5, 7], 'menor');
    assert.equal(e.valor, 5);
    assert.ok(e.alertas.some((a) => /no mínimo 3/.test(a)));
  });
});

describe('análise do item', () => {
  test('decisão manual prevalece sobre o critério e total usa a quantidade', () => {
    const amostras = [
      { id: 1, preco: 10, manual: null },
      { id: 2, preco: 11, manual: null },
      { id: 3, preco: 12, manual: false }, // excluída manualmente
      { id: 4, preco: 13, manual: null },
      { id: 5, preco: 100, manual: null }, // excluída pelo critério
    ];
    const r = analisarItem(amostras, { criterio: { tipo: 'desvio', k: 1 }, metodo: 'media', quantidade: 10 });
    const inc = r.decisoes.filter((d) => d.incluida).map((d) => d.id);
    assert.deepEqual(inc, [1, 2, 4]);
    assert.equal(r.decisoes[2].motivo, 'excluída manualmente');
    assert.match(r.decisoes[4].motivo, /excessivamente elevado/);
    assert.equal(r.estimativa.valor, arredondar((10 + 11 + 13) / 3));
    assert.equal(r.total, arredondar(r.estimativa.valor * 10));
  });
  test('manter manualmente um valor que o critério excluiria', () => {
    const r = analisarItem([{ id: 1, preco: 10, manual: null }, { id: 2, preco: 11, manual: null }, { id: 3, preco: 12, manual: null }, { id: 4, preco: 100, manual: true }], { criterio: { tipo: 'desvio', k: 1 }, metodo: 'media' });
    assert.equal(r.decisoes[3].incluida, true);
    assert.match(r.decisoes[3].motivo, /mantida manualmente/);
  });
});

describe('casos-limite dos critérios de exclusão', () => {
  test('quartis conferem com QUARTIL.INC do Excel', () => {
    const q = quartis([10, 11, 12, 13, 100]);
    assert.equal(q.q1, 11);
    assert.equal(q.q3, 13);
    assert.equal(q.iqr, 2);
    assert.deepEqual(quartis([]), { q1: null, q3: null, iqr: null });
    assert.deepEqual(quartis([7]), { q1: 7, q3: 7, iqr: 0 });
  });
  test('escore z configurável: k maior mantém o que k menor exclui', () => {
    const v = [10, 11, 12, 13, 14, 15, 16, 17, 18, 60];
    assert.equal(avaliarOutliers(v, { tipo: 'desvio', k: 1 }).filter((x) => !x.mantido).length, 1);
    assert.equal(avaliarOutliers(v, { tipo: 'desvio', k: 2 }).filter((x) => !x.mantido).length, 1);
    assert.ok(avaliarOutliers(v, { tipo: 'desvio', k: 3 }).every((x) => x.mantido), 'com n = 10 o escore z máximo é 2,85');
    const lim = limitesCriterio(v, { tipo: 'desvio', k: 2 });
    const r = resumo(v);
    perto(lim.max, r.media + 2 * r.desvioPadrao);
    assert.match(lim.rotulo, /± 2 desvio/);
  });
  test('k decimal aparece com vírgula no motivo', () => {
    const r = avaliarOutliers([10, 11, 12, 13, 100], { tipo: 'iqr', k: 1.5 });
    assert.match(r[4].motivo, /1,5 × IQR/);
  });
  test('todos iguais: nenhum critério exclui (inclusive com ruído de ponto flutuante)', () => {
    for (const valores of [[5, 5, 5, 5], [0.1, 0.1, 0.1], [33.33, 33.33, 33.33, 33.33, 33.33]]) {
      for (const criterio of [{ tipo: 'desvio', k: 1 }, { tipo: 'iqr', k: 1.5 }, { tipo: 'mediana', inferior: 0.5, superior: 0.5 }]) {
        assert.ok(avaliarOutliers(valores, criterio).every((x) => x.mantido), `${criterio.tipo} em ${valores}`);
      }
    }
    const lim = limitesCriterio([5, 5, 5, 5], { tipo: 'desvio', k: 1 });
    assert.equal(lim.aplicavel, false);
    assert.match(lim.nota, /desvio padrão zero/);
  });
  test('IQR zero: critério não se aplica em vez de excluir tudo que difere', () => {
    const valores = [10, 10, 10, 10, 10, 12, 50];
    assert.equal(quartis(valores).iqr, 1, 'controle: aqui o IQR ainda é positivo');
    const zero = [10, 10, 10, 10, 10, 10, 50];
    assert.equal(quartis(zero).iqr, 0);
    const lim = limitesCriterio(zero, { tipo: 'iqr', k: 1.5 });
    assert.equal(lim.aplicavel, false);
    assert.match(lim.nota, /amplitude interquartil igual a zero/);
    assert.ok(avaliarOutliers(zero, { tipo: 'iqr', k: 1.5 }).every((x) => x.mantido));
    const analise = analisarItem(zero.map((preco, id) => ({ id, preco, manual: null })), { criterio: { tipo: 'iqr', k: 1.5 }, metodo: 'mediana' });
    assert.equal(analise.validas, 7);
    assert.ok(analise.estimativa.alertas.some((a) => /amplitude interquartil/.test(a)), 'o usuário é avisado');
  });
  test('n pequeno: 0, 1 e 2 preços não quebram e avisam', () => {
    for (const criterio of [{ tipo: 'desvio', k: 1 }, { tipo: 'iqr' }, { tipo: 'mediana' }]) {
      assert.deepEqual(avaliarOutliers([], criterio), []);
      assert.ok(avaliarOutliers([3], criterio).every((x) => x.mantido));
      assert.ok(avaliarOutliers([1, 1000], criterio).every((x) => x.mantido));
      assert.match(limitesCriterio([1, 1000], criterio).nota, /ao menos 3/);
    }
    const vazio = analisarItem([], { criterio: { tipo: 'iqr' }, metodo: 'media' });
    assert.equal(vazio.estimativa.valor, null);
    assert.equal(vazio.estimativa.insuficiente, true);
    assert.equal(vazio.total, null);
    const dois = precoEstimado([5, 7], 'media');
    assert.equal(dois.insuficiente, true);
    assert.equal(precoEstimado([5, 6, 7], 'media').insuficiente, false);
  });
  test('preço exatamente no limite permanece', () => {
    // mediana 10, faixa ±50% → [5, 15]
    const r = avaliarOutliers([5, 10, 10, 10, 15], { tipo: 'mediana', inferior: 0.5, superior: 0.5 });
    assert.ok(r.every((x) => x.mantido));
  });
  test('critério desconhecido ou ausente equivale a nenhum', () => {
    assert.ok(avaliarOutliers([1, 2, 300], { tipo: 'xyz' }).every((x) => x.mantido));
    assert.ok(avaliarOutliers([1, 2, 300], null).every((x) => x.mantido));
    assert.ok(avaliarOutliers([1, 2, 300]).every((x) => x.mantido));
  });
  test('parâmetros ausentes usam os padrões (z = 1; 1,5 × IQR; ±50%)', () => {
    const v = [10, 11, 12, 13, 100];
    assert.deepEqual(avaliarOutliers(v, { tipo: 'iqr' }), avaliarOutliers(v, { tipo: 'iqr', k: 1.5 }));
    assert.deepEqual(avaliarOutliers(v, { tipo: 'desvio' }), avaliarOutliers(v, { tipo: 'desvio', k: 1 }));
    assert.deepEqual(avaliarOutliers(v, { tipo: 'mediana' }), avaliarOutliers(v, { tipo: 'mediana', inferior: 0.5, superior: 0.5 }));
  });
});

describe('preço recomendado', () => {
  test('devolve as três opções arredondadas e destaca a do critério escolhido', () => {
    const v = [10, 12, 17];
    for (const [metodo, valor] of [['media', 13], ['mediana', 12], ['menor', 10]]) {
      const e = precoEstimado(v, metodo);
      assert.equal(e.valor, valor);
      assert.equal(e.metodoAplicado, metodo);
      assert.deepEqual(e.opcoes, { media: 13, mediana: 12, menor: 10 });
    }
  });
  test('exclusão automática muda a recomendação e informa contagens e limites', () => {
    const amostras = [10, 11, 12, 13, 100].map((preco, id) => ({ id, preco, manual: null }));
    const sem = analisarItem(amostras, { criterio: { tipo: 'nenhum' }, metodo: 'media' });
    const com = analisarItem(amostras, { criterio: { tipo: 'iqr', k: 1.5 }, metodo: 'media' });
    assert.equal(sem.estimativa.valor, 29.2);
    assert.equal(com.estimativa.valor, 11.5);
    assert.equal(com.validas, 4);
    assert.equal(com.excluidas, 1);
    assert.equal(com.limites.aplicavel, true);
    assert.equal(com.limites.min, 8);
    assert.equal(com.limites.max, 16);
  });
  test('exclusões que deixam menos de 3 preços válidos geram aviso', () => {
    const amostras = [{ id: 1, preco: 10, manual: null }, { id: 2, preco: 11, manual: false }, { id: 3, preco: 12, manual: false }, { id: 4, preco: 13, manual: null }];
    const r = analisarItem(amostras, { criterio: { tipo: 'nenhum' }, metodo: 'media' });
    assert.equal(r.validas, 2);
    assert.equal(r.estimativa.insuficiente, true);
    assert.ok(r.estimativa.alertas.some((a) => /no mínimo 3/.test(a)));
  });
});
