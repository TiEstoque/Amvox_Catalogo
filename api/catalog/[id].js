// api/catalog/[id].js
// PATCH  /api/catalog/:id   -> edita um item (Painel Administrativo)
// DELETE /api/catalog/:id   -> remove um item (soft delete: marca ativo=false, nada se perde)

import { getSupabase } from '../_supabase.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Parâmetro "id" ausente.' });

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const { categoria, numero, titulo, descricao, preco } = body;
      if (!categoria || !numero || !titulo || !preco || Number(preco) <= 0) {
        return res.status(400).json({ error: 'Preencha categoria, número, título e preço.' });
      }
      const { error } = await supabase
        .from('items')
        .update({ categoria, numero: String(numero), titulo, descricao: descricao || '—', preco })
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
