// Importação manual de CSV: leitor (csv.mjs), números/datas brasileiros, validação linha a linha e relatório.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lerCsv, detectarSeparador, montarCsv, gerarCsv } from '../server/csv.mjs';
import { importarCsv, lerNumero, lerData, LIMITE_LINHAS, ORIGEM_IMPORTACAO } from '../server/importacao.mjs';

describe('lerCsv', () => {
  test('separador ; com BOM, CRLF, aspas, aspas duplicadas e quebra de linha dentro do campo', () => {
    const l = lerCsv('﻿A;B;C\r\n1;"x; ""y""";3\r\n"linha 1\nlinha 2";;z\r\n');
    assert.deepEqual(l.map((x) => [...x]), [['A', 'B', 'C'], ['1', 'x; "y"', '3'], ['linha 1\nlinha 2', '', 'z']]);
    assert.deepEqual(l.map((x) => x.numero), [1, 2, 3]);
  });
  test('numeração segue as linhas do arquivo mesmo com linhas vazias e campos multilinha', () => {
    const l = lerCsv('A;B\n\n"a\nb";1\n;\nc;2');
    assert.deepEqual(l.map((x) => x.numero), [1, 3, 6]);
    assert.deepEqual([...l[2]], ['c', '2']);
  });
  test('detecta vírgula e tab; ignora separadores dentro de aspas', () => {
    assert.equal(detectarSeparador('a,b,c\n1,2,3'), ',');
    assert.equal(detectarSeparador('a\tb\n1\t2'), '\t');
    assert.equal(detectarSeparador('"a,b,c,d";e\n'), ';');
    assert.equal(detectarSeparador('sozinho\n1'), ';');
    assert.deepEqual([...lerCsv('preco,forn\n"1,5",ACME')[1]], ['1,5', 'ACME']);
  });
  test('ida e volta com montarCsv, inclusive o apóstrofo de proteção contra fórmulas', () => {
    const matriz = [['Texto', 'Valor'], ['=SOMA(A1)', 1.5], ['a;b "c"', '  espaço  '], ['-10', '@x']];
    const lido = lerCsv(montarCsv(matriz));
    assert.deepEqual(lido.map((x) => [...x]), [['Texto', 'Valor'], ['=SOMA(A1)', '1,5'], ['a;b "c"', '  espaço  '], ['-10', '@x']]);
  });
  test('vazio e só espaços', () => {
    assert.deepEqual(lerCsv(''), []);
    assert.deepEqual(lerCsv(null), []);
    assert.deepEqual(lerCsv('\r\n\r\n'), []);
  });
});

describe('lerNumero e lerData', () => {
  test('números brasileiros e internacionais', () => {
    const v = (s) => lerNumero(s).valor;
    assert.equal(v('1.234,56'), 1234.56);
    assert.equal(v('R$ 1.234,56'), 1234.56);
    assert.equal(v('R$1.234.567,89'), 1234567.89);
    assert.equal(v('12,5'), 12.5);
    assert.equal(v('12.5'), 12.5);
    assert.equal(v('1,234.56'), 1234.56);
    assert.equal(v('1234'), 1234);
    assert.equal(v(' 0,0450 '), 0.045);
    assert.deepEqual(lerNumero('1.250'), { valor: 1250, ambiguo: true });
    assert.equal(lerNumero('1.25').ambiguo, false);
  });
  test('ilegíveis → null (nunca um número inventado)', () => {
    for (const ruim of ['', '   ', 'abc', '12 un', '1,2,3', '1.2.3', 'R$', '-', '1e5', '12%', null, undefined]) assert.equal(lerNumero(ruim).valor, null, String(ruim));
  });
  test('datas', () => {
    assert.equal(lerData('05/03/2026'), '2026-03-05');
    assert.equal(lerData('5/3/2026'), '2026-03-05');
    assert.equal(lerData('05-03-2026'), '2026-03-05');
    assert.equal(lerData('05.03.2026 14:30'), '2026-03-05');
    assert.equal(lerData('2026-03-05'), '2026-03-05');
    assert.equal(lerData('2026-03-05T10:00:00'), '2026-03-05');
    for (const ruim of ['', '31/02/2026', '2026-13-01', '05/03/26', 'ontem', '00/01/2026', '03/2026', '01/01/1800']) assert.equal(lerData(ruim), null, ruim);
  });
});

describe('importarCsv', () => {
  const hoje = new Date('2026-11-12T12:00:00Z');
  const CSV = [
    'Item;Descrição;Órgão;UF;Município;Fornecedor;CNPJ;Marca;Unidade;Qtde;Valor Unitário (R$);Data da Homologação;Link;Observação',
    '1;Papel sulfite A4 75g;Prefeitura de Exemplo;ms;Exemplo;PAPELARIA ACME LTDA;12.345.678/0001-90;Chamex;RESMA;100;"R$ 24,90";14/10/2026;https://bllcompras.com/Process/ProcessView?param1=abc;ok',
    '2;Papel sulfite A4;Câmara de Exemplo;MS;;OUTRA LTDA;;;RESMA;;26,5;;;',           // sem data: aviso
    '3;Papel reciclado;Prefeitura X;Mato Grosso;;F;;;;;abc;32/10/2026;;',                // 3 erros
    '4;Papel;Prefeitura Y;SP;;G;;;;0;0;15/10/2026;;',                                    // preço zero e quantidade zero
    '5;Papel;Prefeitura Z;SP;;H;;;;10;19,90;15/10/2027;javascript:alert(1);',            // data futura
    '6;Papel;Prefeitura W;RJ;;I;;;CX;2;1.250;01/09/2026;ftp://x/y;',                     // preço ambíguo + link ignorado
    '2;Papel sulfite A4;Câmara de Exemplo;MS;;OUTRA LTDA;;;RESMA;;26,5;;;',           // repetida
    ';;;;;;;;;;;;;',
  ].join('\r\n');

  test('valida linha a linha: válidas entram, erradas são relatadas com o número da linha do arquivo', () => {
    const r = importarCsv(CSV, { portal: 'bll', hoje });
    assert.equal(r.ok, true);
    assert.equal(r.totalLinhas, 7, 'linha só com separadores não conta');
    assert.deepEqual(r.validas.map((v) => v.linha), [2, 3, 7]);
    assert.deepEqual(r.rejeitadas.map((x) => x.linha), [4, 5, 6]);
    assert.equal(r.repetidas, 1);
    assert.deepEqual(r.ignoradas, ['Item', 'Observação']);
    assert.ok(r.colunas.some((c) => c.cabecalho === 'Valor Unitário (R$)' && c.campo === 'precoUnitario'));

    const a = r.validas[0].amostra;
    assert.deepEqual(a, {
      origem: ORIGEM_IMPORTACAO, portalOrigem: 'bll', dataCompra: '2026-10-14', orgao: 'Prefeitura de Exemplo', uf: 'MS', municipio: 'Exemplo',
      fornecedorNi: '12345678000190', fornecedorNome: 'PAPELARIA ACME LTDA', marca: 'Chamex', descricao: 'Papel sulfite A4 75g', unidade: 'RESMA',
      quantidade: 100, precoUnitario: 24.9, objeto: null, link: 'https://bllcompras.com/Process/ProcessView?param1=abc', chaveOrigem: a.chaveOrigem,
    });
    assert.match(a.chaveOrigem, /^importado-[0-9a-f]{24}$/);
    assert.deepEqual(r.validas[0].avisos, []);
    assert.match(r.validas[1].avisos.join(' '), /Sem data/);
    assert.equal(r.validas[2].amostra.precoUnitario, 1250);
    assert.match(r.validas[2].avisos.join(' '), /lido como 1\.250,00/);
    assert.match(r.validas[2].avisos.join(' '), /Link ignorado/);
    assert.equal(r.validas[2].amostra.link, null);

    const erros = Object.fromEntries(r.rejeitadas.map((x) => [x.linha, x.erros.join(' | ')]));
    assert.match(erros[4], /Preço unitário ilegível: “abc”/);
    assert.match(erros[4], /Data inválida: “32\/10\/2026”/);
    assert.match(erros[4], /UF inválida/);
    assert.match(erros[5], /maior que zero/);
    assert.match(erros[5], /Quantidade inválida/);
    assert.match(erros[6], /Data no futuro/);
    assert.match(r.rejeitadas[0].conteudo, /Papel reciclado/);
  });

  test('a chave é estável: o mesmo arquivo gera as mesmas chaves; outro portal gera outras', () => {
    const k = (portal) => importarCsv(CSV, { portal, hoje }).validas.map((v) => v.amostra.chaveOrigem);
    assert.deepEqual(k('bll'), k('bll'));
    assert.notDeepEqual(k('bll'), k('bnc'));
    assert.equal(new Set(k('bll')).size, 3);
  });

  test('coluna “Portal de origem” na planilha vale para a linha; nome desconhecido cai no portal escolhido, com aviso', () => {
    const r = importarCsv('Preço unitário;Portal de origem\n10;Licitanet\n11;licitar-digital\n12;Portal Inexistente\n13;\n', { portal: 'outro', hoje });
    assert.deepEqual(r.validas.map((v) => v.amostra.portalOrigem), ['licitanet', 'licitar-digital', 'outro', 'outro']);
    assert.match(r.validas[2].avisos.join(' '), /não reconhecido/);
  });

  test('CSV exportado por este sistema volta: só as linhas “Amostra”, com portal e preço', () => {
    const amostra = (preco, portal) => ({ data_compra: '2026-10-01', orgao: 'ORGAO', uf: 'MS', municipio: 'Cidade', fornecedor_nome: 'F', fornecedor_ni: '1', marca: null, preco_unitario: preco, incluida: true, motivo: null, justificativa: null, link: 'https://pncp.gov.br/app/editais/1/2026/1', origem: 'pncp', portal_origem: portal, unidade: 'UN' });
    const resumo = { n: 2, media: 11, mediana: 11, menor: 10, maior: 12, desvioPadrao: 1.41, cv: 0.12 };
    const csv = gerarCsv({ totalGeral: 110, itens: [{ descricao: 'Caneta', quantidade: 10, unidade: 'UN', total: 110, amostras: [amostra(10, 'bll'), amostra(1234.5, 'licitanet')], estimativa: { resumo, valor: 11, metodoAplicado: 'media' } }] });
    const r = importarCsv(csv, { portal: 'pncp', hoje });
    assert.equal(r.ok, true);
    assert.equal(r.puladas, 2, 'RESUMO e total geral');
    assert.deepEqual(r.validas.map((v) => [v.amostra.precoUnitario, v.amostra.portalOrigem, v.amostra.dataCompra]), [[10, 'bll', '2026-10-01'], [1234.5, 'licitanet', '2026-10-01']]);
    assert.equal(r.rejeitadas.length, 0);
  });

  test('problemas do arquivo inteiro: portal, vazio, binário, sem coluna de preço, só cabeçalho, grande demais', () => {
    const erro = (texto, portal = 'bll') => importarCsv(texto, { portal, hoje });
    assert.match(erro('Preço unitário\n10', 'inexistente').erro, /Escolha o portal de origem/);
    assert.match(erro('Preço unitário\n10', null).erro, /Escolha o portal de origem/);
    assert.match(erro('   ').erro, /vazio/);
    assert.match(erro(undefined).erro, /vazio/);
    assert.match(erro('PK\u0003\u0004binário').erro, /não é um CSV de texto/);
    assert.match(erro('Fornecedor;Total\nACME;10').erro, /Não encontrei a coluna de preço unitário.*Fornecedor \| Total/);
    assert.match(erro('Preço unitário;Data').erro, /ao menos uma linha de preço/);
    const grande = `Preço unitário\n${Array.from({ length: LIMITE_LINHAS + 1 }, (_, i) => i + 1).join('\n')}`;
    assert.match(erro(grande).erro, /máximo por importação/);
    for (const r of [erro('   '), erro(grande)]) assert.deepEqual([r.ok, r.validas.length], [false, 0]);
  });

  test('separador vírgula e tab também funcionam', () => {
    assert.equal(importarCsv('fornecedor,valor unitario,data\nACME,"1.234,56",01/10/2026\n', { portal: 'bnc', hoje }).validas[0].amostra.precoUnitario, 1234.56);
    assert.equal(importarCsv('Fornecedor\tPreço\nACME\t9,99\n', { portal: 'bnc', hoje }).validas[0].amostra.precoUnitario, 9.99);
  });
});
