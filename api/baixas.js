// api/baixas.js
// POST /api/baixas -> baixa de uso interno de um item de estoque (admin):
//      { itemId, quantidade, motivo, responsavel }
//      Desconta do estoque e registra quem/quando/por quê.
// GET  /api/baixas -> histórico de baixas internas (admin)

import { getSupabase } from './_supabase.js';
import { requireAdmin } from './_admin.js';
import { enviarEmail, emailConfigurado } from './_email.js';

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;
    const supabase = getSupabase();

    // GET /api/baixas?testeEmail=1 -> diagnóstico do envio de e-mail (admin):
    // manda um teste pro próprio remetente e devolve o erro exato se falhar.
    if (req.method === 'GET' && req.query.testeEmail) {
      if (!emailConfigurado()) {
        return res.status(200).json({
          configurado: false,
          erro: 'EMAIL_REMETENTE e/ou EMAIL_SENHA_APP não estão definidos nas variáveis do projeto amvox (ou o deploy não foi refeito depois de criá-las).',
        });
      }
      const destino = String(req.query.para || '').trim().toLowerCase() || process.env.EMAIL_REMETENTE;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
        return res.status(400).json({ error: 'Destinatário inválido.' });
      }
      try {
        await enviarEmail({
          para: destino,
          assunto: 'Teste de envio — Catálogo Amvox',
          texto: 'Se você recebeu este e-mail, o envio automático do catálogo está funcionando. ✔',
          anexos: [],
        });
        return res.status(200).json({ configurado: true, enviado: true, remetente: process.env.EMAIL_REMETENTE, destino });
      } catch (e) {
        return res.status(200).json({ configurado: true, enviado: false, erro: String((e && e.message) || e) });
      }
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('baixas_internas')
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(200);
      if (error) throw error;
      return res.status(200).json({ baixas: data });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const itemId = String(body.itemId || '').trim();
      const quantidade = Math.max(1, parseInt(body.quantidade, 10) || 1);
      const motivo = String(body.motivo || '').trim();
      const responsavel = String(body.responsavel || '').trim();
      if (!itemId) return res.status(400).json({ error: 'Item não informado.' });
      if (!motivo) return res.status(400).json({ error: 'Informe o motivo da baixa.' });

      const { data: item, error: itErr } = await supabase.from('items').select('*').eq('id', itemId).single();
      if (itErr || !item) return res.status(404).json({ error: 'Item não encontrado.' });
      if (item.estoque === null || item.estoque === undefined) {
        return res.status(400).json({ error: 'Baixa interna só vale pra itens de estoque. Item unitário: use o botão Remover.' });
      }

      const { data: st } = await supabase.from('item_state').select('*').eq('item_id', itemId).maybeSingle();
      const disponiveis = item.estoque - (st?.reserved_qty || 0) - (st?.sold_qty || 0);
      if (quantidade > disponiveis) {
        return res.status(409).json({ error: `Só há ${disponiveis} unidade(s) disponível(is) pra baixa.` });
      }

      const { error: updErr } = await supabase
        .from('items')
        .update({ estoque: item.estoque - quantidade })
        .eq('id', itemId);
      if (updErr) throw updErr;

      const { error: insErr } = await supabase.from('baixas_internas').insert({
        item_id: itemId,
        item_titulo: item.titulo,
        quantidade,
        motivo,
        responsavel: responsavel || null,
      });
      if (insErr) throw insErr;

      return res.status(200).json({ ok: true, estoqueNovo: item.estoque - quantidade });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/baixas:', err);
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
