// api/_concluir.js
// Duas rotinas da venda:
//   gerarNdEEmail  -> gera a Nota de Débito (nome + CPF) e envia o e-mail pra
//                     entrada de notas fiscais (ND + comprovante anexos).
//                     Roda assim que o comprovante do Pix é anexado.
//                     Idempotente: se o chamado já tem ND, não gera outra.
//   concluirChamado-> conclusão definitiva (admin confere e clica "Concluir
//                     venda"): marca os itens como vendidos e garante a ND
//                     (gera só se ainda não existir).
// Falha na ND ou no e-mail nunca desfaz nada — só loga.

import { gerarNotaDebito, formatarCpf } from './_notadebito.js';
import { enviarEmail, emailConfigurado } from './_email.js';

const EMAIL_NOTAS = process.env.EMAIL_NOTAS_DESTINO || 'entradanotasfiscais@amvox.com.br';

export async function gerarNdEEmail({ supabase, chamado, itens }) {
  const protocolo = chamado.protocolo;
  if (chamado.pagamento !== 'Pix') return null;

  // idempotência: chamado já tem ND -> devolve a existente
  const { data: ndExistente } = await supabase
    .from('notas_debito')
    .select('numero')
    .eq('chamado_protocolo', protocolo)
    .maybeSingle();
  if (ndExistente) return ndExistente.numero;

  try {
    // descrição e foto dos itens (pro corpo da ND e conferência visual)
    const ids = [...new Set(itens.map((it) => it.item_id).filter(Boolean))];
    const infoPorId = {};
    if (ids.length) {
      const { data: itemRows } = await supabase.from('items').select('id, descricao, foto_url').in('id', ids);
      (itemRows || []).forEach((r) => { infoPorId[r.id] = r; });
    }
    const itensNd = itens.map((it) => {
      const info = infoPorId[it.item_id] || {};
      return {
        numero: it.numero,
        titulo: it.titulo,
        quantidade: it.quantidade,
        isStock: !!it.is_stock,
        descricao: info.descricao && info.descricao !== '—' ? info.descricao : '',
      };
    });
    const fotos = [];
    for (const it of itens) {
      if (fotos.length >= 2) break;
      const url = infoPorId[it.item_id]?.foto_url;
      if (!url || /\.webp(\?|$)/i.test(url)) continue;
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        fotos.push({
          buffer: Buffer.from(await resp.arrayBuffer()),
          extension: /\.png(\?|$)/i.test(url) ? 'png' : 'jpeg',
        });
      } catch (fotoErr) {
        console.error('ND: falha ao baixar foto do item', it.item_id, fotoErr.message);
      }
    }

    const dataEmissao = new Date();
    const { numero, buffer } = await gerarNotaDebito({
      protocolo,
      pagador: chamado.nome,
      cpf: chamado.matricula,
      valorTotal: Number(chamado.valor_total),
      itens: itensNd,
      fotos,
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

    // E-mail com ND + comprovante — falha aqui não desfaz nada, só loga.
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

    return numero;
  } catch (ndErr) {
    console.error('Erro ao gerar Nota de Débito para', protocolo, ndErr);
    return null;
  }
}

// Aviso automático ao comprador assim que o pagamento entra: compra em
// liberação do Fiscal + instruções do chamado no Gestão. Nunca lança erro.
export async function enviarAvisoFiscal({ chamado, itens }) {
  if (!chamado.email || !emailConfigurado()) return false;
  try {
    const itensTxt = itens
      .map((it) => `  - ${it.is_stock ? '' : `Nº ${it.numero} — `}${it.titulo}${it.quantidade > 1 ? ` (${it.quantidade}x)` : ''}`)
      .join('\n');
    await enviarEmail({
      para: chamado.email,
      assunto: `🧾 Pagamento recebido — próximo passo: chamado no Gestão (${chamado.protocolo})`,
      texto: [
        `Olá, ${chamado.nome}!`,
        ``,
        `Recebemos o seu pagamento — sua compra está EM LIBERAÇÃO DO SETOR FISCAL.`,
        ``,
        `PRÓXIMO PASSO (importante): abra um chamado no Gestão (gestao.amvoxtech.com.br)`,
        `para o Faturamento, categoria "Solicitar faturamento", descrição "Segue compra de itens",`,
        `informando seu nome completo e setor, com analistati1@amvox.com.br em cópia (CC),`,
        `e anexe os 3 arquivos:`,
        `  1) Resumo (imagem)   2) Comprovante do Pix   3) Nota de Débito`,
        `(Baixe o Resumo e a Nota de Débito em "Meus chamados" no catálogo: amvox.vercel.app)`,
        ``,
        `O Faturamento tem até 72 horas para a liberação. Depois disso a TI confere e você`,
        `recebe um novo e-mail com o horário de retirada.`,
        ``,
        `Compra ${chamado.protocolo}:`,
        itensTxt,
        `Valor: R$ ${Number(chamado.valor_total).toFixed(2).replace('.', ',')}`,
        ``,
        `TI Amvox`,
      ].join('\n'),
      anexos: [],
    });
    return true;
  } catch (e) {
    console.error('Erro ao enviar aviso de liberação do Fiscal', chamado.protocolo, e);
    return false;
  }
}

export async function concluirChamado({ supabase, chamado, itens }) {
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

  // garante a ND (gera só se ainda não existir — normalmente já saiu na
  // hora em que o comprovante foi anexado)
  return await gerarNdEEmail({ supabase, chamado, itens });
}
