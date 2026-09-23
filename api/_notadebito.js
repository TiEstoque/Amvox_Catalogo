// api/_notadebito.js
// Gera o arquivo .xlsx da Nota de Débito a partir do modelo (embutido em
// base64 em _nd_template.js), preenchendo os dados do chamado.
// O número da ND vem de public.proximo_numero_nd() no Supabase — uma
// sequência atômica, então nunca duas notas saem com o mesmo número mesmo
// que dois chamados sejam concluídos ao mesmo tempo.

import ExcelJS from 'exceljs';
import { ND_TEMPLATE_BASE64 } from './_nd_template.js';

// A condição sai na linha do item porque a ND é o documento que o comprador
// assina. A nota já diz que o produto não tem garantia e vai no estado em que
// se encontra; dizer QUAL é o estado ("Antigo Desligando as Vezes") é o que
// impede a discussão de "ninguém me avisou" depois da venda.
//
// Uma linha por item. O modelo traz duas (13 e 14) e a folha ganha quantas
// faltarem: com 4 itens, a tabela vai de 13 a 16 e tudo que está abaixo dela
// — dados de pagamento, totais, aviso de garantia, assinaturas e fotos —
// desce junto.
//
// Antes os itens do 2º em diante iam concatenados numa célula só, com o valor
// somado. Na prática o texto estourava a célula e saia cortado na impressão, e
// ninguém conseguia conferir preço por item — justamente o que a nota existe
// para permitir.
//
// Item de estoque (SSD, cooler etc.) não tem patrimônio: sai só o nome.
function montarItens(itensChamado, valorTotal) {
  const linhas = itensChamado.map((it) => {
    const prefixo = it.isStock ? '' : `Nº ${it.numero} — `;
    const desc = it.descricao ? ` — ${it.descricao}` : '';
    const cond = it.condicao ? ` — Condição: ${it.condicao}` : '';
    const qtd = Number(it.quantidade) || 1;
    const valorUnit = Number(it.preco);
    return {
      texto: `${prefixo}${it.titulo}${desc}${cond}${qtd > 1 ? ` (${qtd}x)` : ''}`,
      valor: Number.isFinite(valorUnit) ? valorUnit * qtd : null,
    };
  });
  const total = Number(valorTotal) || 0;
  if (!linhas.length) return [{ texto: '', valor: total }];

  // Rede de segurança: a nota nunca pode fechar com valor diferente do que foi
  // cobrado. Se faltar preço em algum item, ou a soma não bater com o total do
  // chamado, volta ao formato antigo — feio, porém correto no dinheiro.
  const soma = linhas.reduce((a, l) => a + (l.valor || 0), 0);
  const todosComPreco = linhas.every((l) => l.valor !== null);
  if (!todosComPreco || Math.abs(soma - total) > 0.005) {
    return [{ texto: linhas.map((l) => l.texto).join('; '), valor: total }];
  }
  return linhas;
}

// Vigência do preço impressa na nota, logo acima das assinaturas. Como o
// pagador assina a via, a ND vira a prova de qual tabela de preços valia no
// dia da compra — e de que reajuste posterior não mexe no que ele pagou.
const JANELA_PRECOS = { inicio: '07h00', fim: '17h00' };

// Aviso de saldão, em destaque logo acima da assinatura: são equipamentos
// usados, vendidos no estado em que estão e sem garantia.
const AVISO_GARANTIA = 'PRODUTO SEM GARANTIA (produto saldão) — vendido no estado em que se encontra.';

function fmtDataBahia(d) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

function fmtDataHoraBahia(d) {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  const [data, hora] = f.split(', ');
  return hora ? `${data} às ${hora.replace(':', 'h')}` : data;
}

function textoVigencia(dataEmissao, precosValidosAte) {
  const dia = fmtDataBahia(dataEmissao);
  const ate = precosValidosAte ? new Date(precosValidosAte) : null;
  const temAte = ate && !Number.isNaN(ate.getTime());
  // Se a validade cai no próprio dia da compra (modo diário), o parênteses
  // só repetiria a mesma informação — então não entra.
  const publicada = temAte && fmtDataBahia(ate) !== dia
    ? ` (tabela publicada com validade até ${fmtDataHoraBahia(ate)})`
    : '';
  return `Preço praticado conforme a tabela do Catálogo de Vendas Internas vigente em ${dia}, `
    + `das ${JANELA_PRECOS.inicio} às ${JANELA_PRECOS.fim}${publicada}. `
    + `Alterações de preço posteriores não são retroativas: esta Nota de Débito permanece pelo valor acima.`;
}

// CPF entra na nota formatado (000.000.000-00); se vier em formato
// inesperado, mantém como foi digitado pra não perder o dado.
export function formatarCpf(cpf) {
  const digitos = String(cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11) return String(cpf || '').trim();
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

export async function gerarNotaDebito({ protocolo, pagador, cpf, valorTotal, itens, dataEmissao, getNumeroNd, fotos = [], precosValidosAte = null }) {
  const wb = new ExcelJS.Workbook();
  const buffer = Buffer.from(ND_TEMPLATE_BASE64, 'base64');
  await wb.xlsx.load(buffer);

  // Nome completo + CPF viajam juntos no campo Pagador (PARAMETROS!B8),
  // que a aba ND espelha na linha "Pagador:" e o CONTROLE registra.
  const cpfFormatado = formatarCpf(cpf);
  const pagadorComCpf = cpfFormatado ? `${pagador} — CPF: ${cpfFormatado}` : pagador;

  const params = wb.getWorksheet('PARAMETROS');
  const nd = wb.getWorksheet('ND');
  const controle = wb.getWorksheet('CONTROLE');

  const ano = dataEmissao.getUTCFullYear();

  // 1) reserva o próximo número de forma atômica no banco
  const { numero, sequencial } = await getNumeroNd(ano);

  // 2) PARAMETROS — só as células editáveis (fonte azul no modelo original)
  params.getCell('B3').value = ano;
  params.getCell('B6').value = dataEmissao;
  params.getCell('B7').value = dataEmissao;
  params.getCell('B8').value = pagadorComCpf;
  // número da ND: congela como valor fixo (não fica como fórmula, pra nunca
  // mudar depois mesmo que o CONTROLE cresça)
  params.getCell('B4').value = sequencial;
  params.getCell('B5').value = numero;

  // 3) ND — item(ns), número e pagador espelhados (valores fixos, como o D2)
  nd.getCell('D2').value = numero;
  nd.getCell('A9').value = `Pagador: ${pagadorComCpf}`;
  const linhasItens = montarItens(itens, valorTotal);

  // O modelo já traz duas linhas de item (13 e 14). Faltando linhas,
  // duplicateRow copia o estilo e as bordas da 14 e empurra o resto da folha
  // pra baixo — inclusive as células mescladas, que o ExcelJS reposiciona ao
  // gravar. `extras` é o deslocamento que todo o resto precisa respeitar.
  const PRIMEIRA_LINHA_ITEM = 13;
  const LINHAS_NO_MODELO = 2;
  const extras = Math.max(0, linhasItens.length - LINHAS_NO_MODELO);
  if (extras > 0) nd.duplicateRow(PRIMEIRA_LINHA_ITEM + LINHAS_NO_MODELO - 1, extras, true);

  // depois do empurrão, o que estava na linha X do modelo está em X + extras
  const abaixo = (linha) => linha + extras;
  const ultimaLinhaItem = PRIMEIRA_LINHA_ITEM + linhasItens.length - 1;

  linhasItens.forEach((linha, i) => {
    const r = PRIMEIRA_LINHA_ITEM + i;
    nd.getCell(`A${r}`).value = i + 1;
    nd.getCell(`B${r}`).value = linha.texto;
    nd.getCell(`C${r}`).value = linha.valor;
  });

  // Datas: o modelo traz D5/D7 como fórmula (=PARAMETROS!B6/B7) com o
  // resultado ANTIGO em cache (31/08/2026). Quem abre num visualizador que
  // não recalcula (Pré-visualização do Mac, Google Drive, celular, PDF) via
  // a data errada — por isso gravamos a data direto na célula.
  nd.getCell('D5').value = dataEmissao;
  nd.getCell('D7').value = dataEmissao;

  // Totais: mantêm a fórmula, mas agora com o resultado já calculado. Sem
  // isso o arquivo carregava o total do modelo (R$ 200) em TODAS as notas.
  const totalItens = linhasItens.reduce((a, l) => a + (Number(l.valor) || 0), 0);
  const de = PRIMEIRA_LINHA_ITEM;
  const ate = ultimaLinhaItem;
  nd.getCell(`C${abaixo(16)}`).value = { formula: `SUM(C${de}:C${ate})`, result: totalItens };
  nd.getCell(`D${abaixo(16)}`).value = { formula: `SUM(D${de}:D${ate})`, result: 0 };
  nd.getCell(`D${abaixo(17)}`).value = { formula: `C${abaixo(16)}+D${abaixo(16)}`, result: totalItens };
  nd.getCell(`D${abaixo(23)}`).value = { formula: `D${abaixo(17)}-D${abaixo(19)}-D${abaixo(21)}`, result: totalItens };

  // descrições podem ser longas: quebra de linha + altura maior nas linhas de item
  linhasItens.forEach((_, i) => {
    const r = PRIMEIRA_LINHA_ITEM + i;
    const cell = nd.getCell(`B${r}`);
    if (cell.value) {
      cell.alignment = Object.assign({}, cell.alignment, { wrapText: true, vertical: 'middle' });
      nd.getRow(r).height = Math.max(nd.getRow(r).height || 15, 42);
    }
  });

  // Aviso de garantia + vigência do preço, entre os totais e a linha de
  // assinatura (A25:D25). Duas linhas na mesma célula: a de cima em destaque.
  try { nd.mergeCells(`A${abaixo(25)}:D${abaixo(25)}`); } catch { /* já mesclado */ }
  const celulaVigencia = nd.getCell(`A${abaixo(25)}`);
  celulaVigencia.value = {
    richText: [
      { font: { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF8F1D1D' } }, text: AVISO_GARANTIA },
      { font: { name: 'Calibri', size: 8, italic: true }, text: '\n' + textoVigencia(dataEmissao, precosValidosAte) },
    ],
  };
  celulaVigencia.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  nd.getRow(abaixo(25)).height = 42;

  // foto(s) do(s) item(ns) abaixo das assinaturas, pra conferência visual
  if (fotos && fotos.length) {
    // A âncora da imagem é por número de linha e não acompanha o empurrão
    // sozinha: sem somar `extras`, a foto cai por cima do próprio rótulo.
    nd.getCell(`A${abaixo(30)}`).value = 'Foto do(s) item(ns):';
    nd.getCell(`A${abaixo(30)}`).font = { bold: true };
    fotos.slice(0, 2).forEach((f, idx) => {
      const imgId = wb.addImage({ buffer: f.buffer, extension: f.extension });
      nd.addImage(imgId, { tl: { col: idx * 2, row: abaixo(30) }, ext: { width: 190, height: 140 } });
    });
  }

  // 4) CONTROLE — regista a nota emitida. Cada arquivo é uma cópia nova do
  // modelo, então a linha 4 (que no modelo traz a ND de exemplo) passa a ser
  // ESTA nota — senão o Fiscal abre e vê o pagador/valor do exemplo.
  const linhaControle = controle.getRow(4);
  linhaControle.getCell(1).value = numero;
  linhaControle.getCell(2).value = dataEmissao;
  linhaControle.getCell(3).value = pagadorComCpf;
  linhaControle.getCell(4).value = valorTotal;
  linhaControle.getCell(5).value = 'Emitida';
  linhaControle.commit();

  const outBuffer = await wb.xlsx.writeBuffer();
  return { numero, sequencial, buffer: outBuffer };
}
