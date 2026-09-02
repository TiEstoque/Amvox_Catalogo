// api/_concluir.js
// Conclusão definitiva de um chamado: marca os itens como vendidos, gera a
// Nota de Débito (nome + CPF) e envia por e-mail pra entrada de notas fiscais,
// com o comprovante do Pix anexo quando houver. Usada em dois lugares:
//   - api/comprovante.js  -> confirmação automática ao anexar o comprovante
//   - api/reservas/[protocolo].js -> conclusão manual pelo painel (casos sem
//     comprovante, ex.: status "Pix informado" antigo)
// Falha na ND ou no e-mail nunca desfaz a conclusão — só loga.

import { gerarNotaDebito, formatarCpf } from './_notadebito.js';
import { enviarEmail, emailConfigurado } from './_email.js';

const EMAIL_NOTAS = process.env.EMAIL_NOTAS_DESTINO || 'entradanotasfiscais@amvox.com.br';

export async function concluirChamado({ supabase, chamado, itens }) {
  const protocolo = chamado.protocolo;

  // marca como vendido definitivamente
  for (const it of itens) {
    if (it.is_stock) {
      const { data: st } = await supabase.from('item_state').select('*').eq('item_id', it.item_id).single();
      const reserved = Math.max(0, (st?.reserved_qty || 0) - it.quantidade);
      const sold = (st?.sold_qty || 0) + it.quantidade;
      await supabase
        .from('item_state')
        .upsert({ item_id: it.item_id, reserved_qty: reserved, sold_qty: sold, updated_at: new Date().toISOString() });
    } else {
      await supabase
        .from('item_state')
        .upsert({ item_id: it.item_id, status: 'Vendido', updated_at: new Date().toISOString() });
    }
  }

  let notaDebitoNumero = null;

  // Nota de Débito automática — só pra chamados pagos via Pix
  if (chamado.pagamento === 'Pix') {
    try {
      const dataEmissao = new Date();
      const { numero, buffer } = await gerarNotaDebito({
        protocolo,
        pagador: chamado.nome,
        cpf: chamado.matricula,
        valorTotal: Number(chamado.valor_total),
        itens: itens.map((it) => ({ numero: it.numero, titulo: it.titulo, quantidade: it.quantidade })),
        dataEmissao,
        getNumeroNd: async (ano) => {
          const { data: seqData, error: seqErr } = await supabase.rpc('proximo_numero_nd');
          if (seqErr) throw seqErr;
          const sequencial = Number(seqData);
          return { numero: ano * 100000 + sequencial, sequencial };
        },
      });

      const arquivoPath = `${numero}.xlsx`;
      const { error: upErr } = await supabase.storage
        .from('notas-debito')
        .upload(arquivoPath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true,
        });
      if (upErr) throw upErr;

      const ano = dataEmissao.getUTCFullYear();
      await supabase.from('notas_debito').insert({
        numero,
        ano,
        sequencial: numero - ano * 100000,
        chamado_protocolo: protocolo,
        pagador: chamado.nome,
        valor: Number(chamado.valor_total),
        data_emissao: dataEmissao.toISOString().slice(0, 10),
        arquivo_path: arquivoPath,
      });

      notaDebitoNumero = numero;

      // Envia a ND por e-mail pra entrada de notas fiscais, com o comprovante
      // do Pix junto quando houver. Falha aqui não desfaz nada — só loga.
      try {
        if (emailConfigurado()) {
          const anexos = [{ filename: `${numero}.xlsx`, content: Buffer.from(buffer) }];
          if (chamado.comprovante_path) {
            try {
              const { data: cmp, error: cmpErr } = await supabase.storage
                .from('comprovantes')
                .download(chamado.comprovante_path);
              if (cmpErr) throw cmpErr;
              const ext = chamado.comprovante_path.split('.').pop() || 'jpg';
              anexos.push({ filename: `comprovante-${protocolo}.${ext}`, content: Buffer.from(await cmp.arrayBuffer()) });
            } catch (cmpErr) {
              console.error('ND', numero, 'sem anexo do comprovante:', cmpErr.message);
            }
          }
          const itensTxt = itens
            .map((it) => `  - Nº ${it.numero} — ${it.titulo} (${it.quantidade}x)`)
            .join('\n');
          await enviarEmail({
            para: EMAIL_NOTAS,
            assunto: `Nota de Débito ${numero} — ${chamado.nome} (${protocolo})`,
            texto: [
              `Nota de Débito emitida automaticamente pelo Catálogo de Vendas Internas.`,
              ``,
              `Número: ${numero}`,
              `Chamado: ${protocolo}`,
              `Pagador: ${chamado.nome} — CPF: ${formatarCpf(chamado.matricula)}`,
              `Setor: ${chamado.setor || '-'}`,
              `Valor: R$ ${Number(chamado.valor_total).toFixed(2).replace('.', ',')}`,
              `Data de emissão: ${dataEmissao.toLocaleDateString('pt-BR')}`,
              ``,
              `Itens:`,
              itensTxt,
              ``,
              chamado.comprovante_path
                ? `A nota e o comprovante do Pix seguem em anexo.`
                : `O arquivo da nota segue em anexo.`,
            ].join('\n'),
            anexos,
          });
        } else {
          console.warn('ND', numero, 'não enviada por e-mail: EMAIL_REMETENTE/EMAIL_SENHA_APP não configurados na Vercel.');
        }
      } catch (mailErr) {
        console.error('Erro ao enviar ND', numero, 'por e-mail:', mailErr);
      }
    } catch (ndErr) {
      // Não deixa a conclusão do chamado falhar por causa da ND — só loga.
      // O chamado já foi concluído normalmente; a ND pode ser gerada depois manualmente se precisar.
      console.error('Erro ao gerar Nota de Débito para', protocolo, ndErr);
    }
  }

  return notaDebitoNumero;
}
