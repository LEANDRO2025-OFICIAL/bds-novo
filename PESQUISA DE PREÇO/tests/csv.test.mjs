import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { csvCampo, csvNumero, montarCsv, gerarCsv, dinheiro, CABECALHO } from '../server/csv.mjs';

describe('célula CSV', () => {
  test('decimais com vírgula, sem notação científica', () => {
    assert.equal(csvCampo(6.2), '6,2');
    assert.equal(csvCampo(dinheiro(6.2)), '6,20');
    assert.equal(csvCampo(dinheiro(1234567.891)), '1234567,89');
    assert.equal(csvCampo(10), '10');
    assert.equal(csvCampo(0), '0');
    assert.equal(csvNumero(1e-7), '0,0000001');
    assert.equal(csvCampo(NaN), '');
    assert.equal(csvCampo(null), '');
    assert.equal(csvCampo(undefined), '');
    assert.equal(csvCampo(dinheiro(null)), '');
  });
  test('escapa aspas, ponto e vírgula e quebras de linha', () => {
    assert.equal(csvCampo('simples'), 'simples');
    assert.equal(csvCampo('a;b'), '"a;b"');
    assert.equal(csvCampo('diz "oi"'), '"diz ""oi"""');
    assert.equal(csvCampo('linha1\nlinha2'), '"linha1\nlinha2"');
    assert.equal(csvCampo('linha1\r\nlinha2'), '"linha1\r\nlinha2"');
    assert.equal(csvCampo(' com espaço '), '" com espaço "');
    assert.equal(csvCampo('vírgula, não precisa'), 'vírgula, não precisa');
  });
  test('neutraliza injeção de fórmula (= + - @, tab, CR)', () => {
    assert.equal(csvCampo('=SOMA(A1:A9)'), "'=SOMA(A1:A9)");
    assert.equal(csvCampo('+55 67 99999'), "'+55 67 99999");
    assert.equal(csvCampo('-2+3'), "'-2+3");
    assert.equal(csvCampo('@cmd'), "'@cmd");
    assert.equal(csvCampo('\t=1+1'), "'\t=1+1");
    assert.equal(csvCampo('\r=1+1'), '"\'\r=1+1"');
    assert.equal(csvCampo('=HYPERLINK("http://x";"clique")'), '"\'=HYPERLINK(""http://x"";""clique"")"');
    assert.equal(csvCampo('a=b'), 'a=b', 'só importa o primeiro caractere');
    assert.equal(csvCampo(-5.5), '-5,5', 'número negativo de verdade continua número');
  });
});

describe('arquivo CSV byte a byte', () => {
  test('BOM UTF-8, separador ;, CRLF em todas as linhas', () => {
    const bytes = Buffer.from(montarCsv([['Preço', 'Órgão'], [1.5, 'a;b'], ['=1', 'x"y']]), 'utf8');
    const esperado = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from('Preço;Órgão\r\n', 'utf8'),
      Buffer.from('1,5;"a;b"\r\n', 'utf8'),
      Buffer.from('\'=1;"x""y"\r\n', 'utf8'),
    ]);
    assert.deepEqual(bytes, esperado);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    // "ç" de Preço em UTF-8: C3 A7
    assert.deepEqual([...bytes.subarray(6, 8)], [0xC3, 0xA7]);
    // nenhum LF sem CR antes
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0A) assert.equal(bytes[i - 1], 0x0D, `LF solto na posição ${i}`);
  });

  test('pesquisa completa: colunas alinhadas, estatísticas e total', () => {
    const pesquisa = {
      totalGeral: 66.3,
      itens: [{
        descricao: 'Tinta; "preta"\n500 ml', quantidade: 10, unidade: 'UN', total: 66.3,
        estimativa: { valor: 6.63, metodoAplicado: 'media', resumo: { n: 2, media: 6.625, mediana: 6.625, menor: 6.2, maior: 7.05, desvioPadrao: 0.601, cv: 0.0907 } },
        amostras: [
          { data_compra: '2026-08-13', orgao: '=cmd|\'/c calc\'!A1', uf: 'MS', municipio: 'Corumbá', fornecedor_nome: '@Fornecedor Ltda', fornecedor_ni: '56385366000180', marca: null, preco_unitario: 6.2, incluida: true, motivo: null, justificativa: null, link: 'https://exemplo/compra?a=1;b=2', origem: 'compras.gov.br' },
          { data_compra: '2026-08-14', orgao: 'Prefeitura', uf: 'MS', municipio: null, fornecedor_nome: 'B', fornecedor_ni: null, marca: 'X', preco_unitario: 7.05, incluida: true, motivo: null, justificativa: null, link: null, origem: 'pncp' },
          { data_compra: '2026-08-15', orgao: 'Câmara', uf: 'SP', municipio: null, fornecedor_nome: 'C', fornecedor_ni: null, marca: null, preco_unitario: 25, incluida: false, motivo: 'excluída manualmente', justificativa: 'Marca incompatível', link: null, origem: 'cotacao-fornecedor' },
        ],
      }],
    };
    const texto = gerarCsv(pesquisa);
    assert.equal(texto.charCodeAt(0), 0xFEFF);
    assert.ok(texto.endsWith('\r\n'));
    // Parser mínimo RFC 4180 com ';' para conferir que toda linha tem o mesmo nº de colunas
    const linhas = [];
    let campo = ''; let linha = []; let aspas = false;
    const t = texto.slice(1);
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (aspas) {
        if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ';') { linha.push(campo); campo = ''; } else if (c === '\r' && t[i + 1] === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; i++; } else campo += c;
    }
    assert.equal(linhas.length, 6, 'cabeçalho + 3 amostras + resumo + total');
    for (const l of linhas) assert.equal(l.length, CABECALHO.length);
    const col = (nome) => CABECALHO.indexOf(nome);
    assert.equal(linhas[1][col('Descrição')], 'Tinta; "preta"\n500 ml', 'texto com ; aspas e quebra volta intacto');
    assert.equal(linhas[1][col('Órgão')], "'=cmd|'/c calc'!A1");
    assert.equal(linhas[1][col('Fornecedor')], "'@Fornecedor Ltda");
    assert.equal(linhas[1][col('Preço unitário')], '6,20');
    assert.equal(linhas[1][col('Fonte')], 'https://exemplo/compra?a=1;b=2');
    assert.equal(linhas[3][col('Considerada')], 'Não');
    assert.equal(linhas[3][col('Motivo/Justificativa')], 'excluída manualmente — Marca incompatível');
    const resumo = linhas[4];
    assert.equal(resumo[col('Registro')], 'RESUMO');
    assert.equal(resumo[col('Válidas')], '2');
    assert.equal(resumo[col('Excluídas')], '1');
    assert.equal(resumo[col('Média')], '6,63');
    assert.equal(resumo[col('Maior')], '7,05');
    assert.equal(resumo[col('Desvio padrão')], '0,60');
    assert.equal(resumo[col('CV (%)')], '9,1');
    assert.equal(resumo[col('Preço recomendado')], '6,63');
    assert.equal(resumo[col('Critério')], 'média');
    assert.equal(resumo[col('Total do item')], '66,30');
    assert.equal(linhas[5][col('Total do item')], '66,30');
  });
});
