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
function montarItens(itensChamado) {
  const linhas = itensChamado.map((it) => `Nº ${it.numero} — ${it.titulo}${it.quantidade > 1 ? ` (${it.quantidade}x)` : ''}`);
  if (linhas.length <= 2) return linhas;
  const primeiras = linhas.slice(0, 1);
  const resto = linhas.slice(1).join('; ');
  return [...primeiras, resto];
}

// CPF entra na nota formatado (000.000.000-00); se vier em formato
// inesperado, mantém como foi digitado pra não perder o dado.
export function formatarCpf(cpf) {
  const digitos = String(cpf || '').replace(/\D/g, '');
  if (digitos.length !== 11) return String(cpf || '').trim();
  return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
}

export async function gerarNotaDebito({ protocolo, pagador, cpf, valorTotal, itens, dataEmissao, getNumeroNd }) {
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
  const linhasItens = montarItens(itens);
  nd.getCell('A13').value = 1;
  nd.getCell('B13').value = linhasItens[0] || '';
  nd.getCell('C13').value = valorTotal;
  if (linhasItens[1]) {
    nd.getCell('A14').value = 2;
    nd.getCell('B14').value = linhasItens[1];
    // valor todo já foi lançado na linha 1 (C13) pra bater com o total do chamado
  }

  // 4) CONTROLE — regista a nota emitida
  const linhaControle = controle.lastRow.number + 1;
  const origem = controle.getRow(4);
  const nova = controle.getRow(linhaControle);
  nova.getCell(1).value = numero;
  nova.getCell(2).value = dataEmissao;
  nova.getCell(3).value = pagadorComCpf;
  nova.getCell(4).value = valorTotal;
  nova.getCell(5).value = 'Emitida';
  [1, 2, 3, 4, 5].forEach((c) => {
    nova.getCell(c).style = origem.getCell(c).style;
  });
  nova.commit();

  const outBuffer = await wb.xlsx.writeBuffer();
  return { numero, sequencial, buffer: outBuffer };
}
