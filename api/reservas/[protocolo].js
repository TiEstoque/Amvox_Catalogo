// api/reservas/[protocolo].js
// PATCH /api/reservas/:protocolo -> aprova, reprova, conclui ou cancela um chamado
// (usado pelo Painel Administrativo)

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';
import { gerarNotaDebito } from '../_notadebito.js';

const ALLOWED_STATUS = ['Aprovado pelo DP', 'Reprovado pelo DP', 'Concluído', 'Cancelado'];

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const { protocolo } = req.query;
    if (!protocolo) return res.status(400).json({ error: 'Parâmetro "protocolo" ausente.' });

    if (req.method !== 'PATCH') {
      res.setHeader('Allow', 'PATCH');
      return res.status(405).json({ error: 'Método não permitido.' });
    }

    const body = parseBody(req);
    const { status, observacaoDP } = body;

    // Associado avisando que fez o Pix — não exige login de admin, mas só
    // funciona com o CPF do próprio chamado e a partir do status certo.
    if (status === 'Pix informado') {
      const cpfInformado = String(body.matricula || '').replace(/\D/g, '');
      if (!cpfInformado) return res.status(400).json({ error: 'Informe o CPF usado na reserva.' });

      const { data: chamadoPix, error: pixErr } = await supabase
        .from('chamados')
        .select('protocolo, status, matricula')
        .eq('protocolo', protocolo)
        .single();
      if (pixErr || !chamadoPix) return res.status(404).json({ error: 'Chamado não encontrado.' });
      if (String(chamadoPix.matricula || '').replace(/\D/g, '') !== cpfInformado) {
        return res.status(403).json({ error: 'CPF não confere com o desse chamado.' });
      }
      if (chamadoPix.status !== 'Aguardando pagamento Pix') {
        return res.status(409).json({ error: 'Esse chamado não está aguardando pagamento Pix.' });
      }

      const { error: pixUpdErr } = await supabase
        .from('chamados')
        .update({ status: 'Pix informado' })
        .eq('protocolo', protocolo);
      if (pixUpdErr) throw pixUpdErr;

      return res.status(200).json({ protocolo, status: 'Pix informado' });
    }

    if (!requireAdmin(req, res)) return;

    if (!ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const { data: chamado, error: getErr } = await supabase
      .from('chamados')
      .select('*')
      .eq('protocolo', protocolo)
      .single();
    if (getErr || !chamado) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { data: itens, error: itensErr } = await supabase
      .from('chamado_itens')
      .select('*')
      .eq('chamado_protocolo', protocolo);
    if (itensErr) throw itensErr;

    const updatePayload = { status };
    if (observacaoDP !== undefined && observacaoDP !== null && observacaoDP !== '') {
      updatePayload.observacao_dp = observacaoDP;
    }
    const { error: updErr } = await supabase.from('chamados').update(updatePayload).eq('protocolo', protocolo);
    if (updErr) throw updErr;

    let notaDebitoNumero = null;

    if (status === 'Reprovado pelo DP' || status === 'Cancelado') {
      // libera os itens de volta pro catálogo
      for (const it of itens) {
        if (it.is_stock) {
          const { data: st } = await supabase.from('item_state').select('*').eq('item_id', it.item_id).single();
          const reserved = Math.max(0, (st?.reserved_qty || 0) - it.quantidade);
          await supabase
            .from('item_state')
            .upsert({ item_id: it.item_id, reserved_qty: reserved, updated_at: new Date().toISOString() });
        } else {
          await supabase
            .from('item_state')
            .upsert({ item_id: it.item_id, status: 'Disponível', updated_at: new Date().toISOString() });
        }
      }
    } else if (status === 'Concluído') {
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

      // Nota de Débito automática — só pra chamados pagos via Pix
      if (chamado.pagamento === 'Pix') {
        try {
          const dataEmissao = new Date();
          const { numero, buffer } = await gerarNotaDebito({
            protocolo,
            pagador: chamado.nome,
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
        } catch (ndErr) {
          // Não deixa a conclusão do chamado falhar por causa da ND — só loga.
          // O chamado já foi concluído normalmente; a ND pode ser gerada depois manualmente se precisar.
          console.error('Erro ao gerar Nota de Débito para', protocolo, ndErr);
        }
      }
    }

    return res.status(200).json({ protocolo, status, notaDebitoNumero });
  } catch (err) {
    console.error('Erro em /api/reservas/[protocolo]:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body || {};
}
