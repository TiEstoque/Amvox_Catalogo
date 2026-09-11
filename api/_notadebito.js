// api/_notadebito.js
// Gera o arquivo .xlsx da Nota de Débito a partir do modelo (embutido em
// base64 em _nd_template.js), preenchendo os dados do chamado.
// O número da ND vem de public.proximo_numero_nd() no Supabase — uma
// sequência atômica, então nunca duas notas saem com o mesmo número mesmo
// que dois chamados sejam concluídos ao mesmo tempo.

import ExcelJS from 'exceljs';
import { ND_TEMPLATE_BASE64 } from './_nd_template.js';

// Modelo suporta até 2 itens na tabela (linhas 13 e 14). Com mais que isso,
// concatena os demais na descrição do 2º item pra não perder informação.
// Item de estoque (SSD, cooler etc.) não tem patrimônio: sai só o nome.
// Cada linha leva o seu valor (preço x quantidade); com 3+ itens, a 2ª linha
// soma o valor dos demais. O total da ND é =SUM(C13:C14) no modelo, então
// as duas linhas sempre fecham com o total do chamado.
function montarItens(itensChamado, valorTotal) {
  const linhas = itensChamado.map((it) => {
    const prefixo = it.isStock ? '' : `Nº ${it.numero} — `;
    const desc = it.descricao ? ` — ${it.descricao}` : '';
    const qtd = Number(it.quantidade) || 1;
    const valorUnit = Number(it.preco);
    return {
      texto: `${prefixo}${it.titulo}${desc}${qtd > 1 ? ` (${qtd}x)` : ''}`,
      valor: Number.isFinite(valorUnit) ? valorUnit * qtd : null,
    };
  });
  const total = Number(valorTotal) || 0;
  if (linhas.length <= 1) return [{ texto: linhas[0] ? linhas[0].texto : '', valor: total }];
  const primeira = linhas[0];
  const restoTexto = linhas.slice(1).map((l) => l.texto).join('; ');
  // se algum preço não veio, mantém o comportamento antigo: tudo na 1ª linha
  const valorPrimeira = linhas.every((l) => l.valor !== null) ? Math.min(primeira.valor, total) : total;
  return [
    { texto: primeira.texto, valor: valorPrimeira },
    { texto: restoTexto, valor: Math.max(0, total - valorPrimeira) },
  ];
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
  nd.getCell('A13').value = 1;
  nd.getCell('B13').value = linhasItens[0].texto;
  nd.getCell('C13').value = linhasItens[0].valor;
  if (linhasItens[1]) {
    nd.getCell('A14').value = 2;
    nd.getCell('B14').value = linhasItens[1].texto;
    nd.getCell('C14').value = linhasItens[1].valor; // total = SUM(C13:C14) no modelo
  }

  // Datas: o modelo traz D5/D7 como fórmula (=PARAMETROS!B6/B7) com o
  // resultado ANTIGO em cache (31/08/2026). Quem abre num visualizador que
  // não recalcula (Pré-visualização do Mac, Google Drive, celular, PDF) via
  // a data errada — por isso gravamos a data direto na célula.
  nd.getCell('D5').value = dataEmissao;
  nd.getCell('D7').value = dataEmissao;

  // Totais: mantêm a fórmula, mas agora com o resultado já calculado. Sem
  // isso o arquivo carregava o total do modelo (R$ 200) em TODAS as notas.
  const totalItens = linhasItens.reduce((a, l) => a + (Number(l.valor) || 0), 0);
  nd.getCell('C16').value = { formula: 'SUM(C13:C14)', result: totalItens };
  nd.getCell('D16').value = { formula: 'SUM(D13:D14)', result: 0 };
  nd.getCell('D17').value = { formula: 'C16+D16', result: totalItens };
  nd.getCell('D23').value = { formula: 'D17-D19-D21', result: totalItens };

  // descrições podem ser longas: quebra de linha + altura maior nas linhas de item
  [13, 14].forEach((r) => {
    const cell = nd.getCell(`B${r}`);
    if (cell.value) {
      cell.alignment = Object.assign({}, cell.alignment, { wrapText: true, vertical: 'middle' });
      nd.getRow(r).height = Math.max(nd.getRow(r).height || 15, 42);
    }
  });

  // Aviso de garantia + vigência do preço, entre os totais e a linha de
  // assinatura (A25:D25). Duas linhas na mesma célula: a de cima em destaque.
  try { nd.mergeCells('A25:D25'); } catch { /* já mesclado */ }
  const celulaVigencia = nd.getCell('A25');
  celulaVigencia.value = {
    richText: [
      { font: { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FF8F1D1D' } }, text: AVISO_GARANTIA },
      { font: { name: 'Calibri', size: 8, italic: true }, text: '\n' + textoVigencia(dataEmissao, precosValidosAte) },
    ],
  };
  celulaVigencia.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  nd.getRow(25).height = 42;

  // foto(s) do(s) item(ns) abaixo das assinaturas, pra conferência visual
  if (fotos && fotos.length) {
    nd.getCell('A30').value = 'Foto do(s) item(ns):';
    nd.getCell('A30').font = { bold: true };
    fotos.slice(0, 2).forEach((f, idx) => {
      const imgId = wb.addImage({ buffer: f.buffer, extension: f.extension });
      nd.addImage(imgId, { tl: { col: idx * 2, row: 30 }, ext: { width: 190, height: 140 } });
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
