// api/catalog/[id].js
// PATCH  /api/catalog/:id   -> edita um item (Painel Administrativo — exige login)
// DELETE /api/catalog/:id   -> remove um item (Painel Administrativo — exige login; soft delete)

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    const supabase = getSupabase();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Parâmetro "id" ausente.' });

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const { categoria, numero, titulo, descricao, preco, condicao, fotoUrl } = body;
      if (!categoria || !numero || !titulo || !preco || Number(preco) <= 0) {
        return res.status(400).json({ error: 'Preencha categoria, número, título e preço.' });
      }
      const updatePayload = { categoria, numero: String(numero), titulo, descricao: descricao || '—', condicao: condicao || null, preco };
      if (fotoUrl !== undefined) updatePayload.foto_url = fotoUrl || null;

      // Estoque (quantidade) — só para itens que JÁ têm quantidade (estoque != null).
      // Trava: a quantidade nova não pode ser menor que vendidos + reservados,
      // senão a disponibilidade do catálogo fica inconsistente.
      if (body.estoque !== undefined && body.estoque !== null && String(body.estoque).trim() !== '') {
        const novo = parseInt(body.estoque, 10);
        if (!Number.isInteger(novo) || novo < 0) {
          return res.status(400).json({ error: 'Quantidade de estoque inválida (use um número inteiro maior ou igual a 0).' });
        }
        const { data: itemAtual, error: itErr } = await supabase.from('items').select('estoque').eq('id', id).maybeSingle();
        if (itErr) throw itErr;
        if (!itemAtual) return res.status(404).json({ error: 'Item não encontrado.' });
        if (itemAtual.estoque === null || itemAtual.estoque === undefined) {
          return res.status(400).json({ error: 'Esse item é único (sem quantidade). Só itens de estoque têm quantidade editável.' });
        }
        const { data: st, error: stErr } = await supabase.from('item_state').select('reserved_qty, sold_qty').eq('item_id', id).maybeSingle();
        if (stErr) throw stErr;
        const minimo = (st?.reserved_qty || 0) + (st?.sold_qty || 0);
        if (novo < minimo) {
          return res.status(400).json({ error: `A quantidade não pode ser menor que ${minimo} (já vendidos + reservados).` });
        }
        updatePayload.estoque = novo;
      }

      const { error } = await supabase
        .from('items')
        .update(updatePayload)
        .eq('id', id);
      if (error) throw error;
      return res.status(200).json({ id });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from('items').update({ ativo: false }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ id, removed: true });
    }

    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/catalog/[id]:', err);
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
