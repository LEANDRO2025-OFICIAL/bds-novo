import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resumo, mediana, avaliarOutliers, precoEstimado, analisarItem, arredondar } from '../server/estatistica.mjs';

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
