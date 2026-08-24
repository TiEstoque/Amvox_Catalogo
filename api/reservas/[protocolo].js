// api/reservas/[protocolo].js
// PATCH /api/reservas/:protocolo -> aprova, reprova, conclui ou cancela um chamado
// (usado pelo Painel Administrativo)

import { getSupabase } from '../_supabase.js';

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
    }

    return res.status(200).json({ protocolo, status });
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
