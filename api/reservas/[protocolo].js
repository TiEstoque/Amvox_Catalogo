// api/reservas/[protocolo].js
// PATCH /api/reservas/:protocolo -> aprova, reprova, conclui ou cancela um chamado
// (usado pelo Painel Administrativo)

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';
import { concluirChamado } from '../_concluir.js';

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

    // Marcar entrega física de um chamado concluído (aba "Itens vendidos")
    if (body.entrega) {
      const { data: chamadoEnt, error: entGetErr } = await supabase
        .from('chamados')
        .select('protocolo, status')
        .eq('protocolo', protocolo)
        .single();
      if (entGetErr || !chamadoEnt) return res.status(404).json({ error: 'Chamado não encontrado.' });
      if (chamadoEnt.status !== 'Concluído') {
        return res.status(409).json({ error: 'Só é possível marcar entrega de chamado Concluído.' });
      }
      const { error: entErr } = await supabase
        .from('chamados')
        .update({
          entregue_em: new Date().toISOString(),
          entregue_obs: String(body.obs || '').trim() || null,
        })
        .eq('protocolo', protocolo);
      if (entErr) throw entErr;
      return res.status(200).json({ protocolo, entregue: true });
    }

    if (!ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const { data: chamado, error: getErr } = await supabase
      .from('chamados')
      .select('*')
      .eq('protocolo', protocolo)
      .single();
    if (getErr || !chamado) return res.status(404).json({ error: 'Chamado não encontrado.' });

    // Trava contra clique duplo / reprocessamento: chamado finalizado não muda
    // mais de status (evita somar venda ou devolver estoque em dobro).
    const FINALIZADOS = ['Concluído', 'Cancelado', 'Reprovado pelo DP'];
    if (FINALIZADOS.includes(chamado.status)) {
      return res.status(409).json({ error: `Esse chamado já foi finalizado (${chamado.status}).` });
    }

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
      // vendido + ND + e-mail — mesma rotina da confirmação automática
      // por comprovante (api/_concluir.js)
      notaDebitoNumero = await concluirChamado({ supabase, chamado, itens });
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
