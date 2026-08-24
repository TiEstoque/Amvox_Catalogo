// api/catalog/index.js
// GET  /api/catalog          -> lista todos os itens ativos, já com disponibilidade calculada
// POST /api/catalog          -> adiciona um item novo (Painel Administrativo)

import { getSupabase } from '../_supabase.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data: items, error: itemsErr } = await supabase
        .from('items')
        .select('*')
        .eq('ativo', true)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const { data: states, error: stateErr } = await supabase.from('item_state').select('*');
      if (stateErr) throw stateErr;

      const stateMap = Object.fromEntries(states.map((s) => [s.item_id, s]));
      const shaped = items.map((row) => shapeItem(row, stateMap[row.id] || {}));
      return res.status(200).json({ items: shaped });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const { categoria, numero, titulo, descricao, preco, estoque, condicao } = body;

      if (!categoria || !numero || !titulo || !preco || Number(preco) <= 0) {
        return res.status(400).json({ error: 'Preencha categoria, número, título e preço.' });
      }

      const id = 'CUSTOM-' + Date.now();
      const estoqueVal =
        estoque === undefined || estoque === null || estoque === '' ? null : parseInt(estoque, 10);

      const { error: insErr } = await supabase.from('items').insert({
        id,
        categoria,
        numero: String(numero),
        titulo,
        descricao: descricao || '—',
        condicao: condicao || null,
        preco,
        estoque: estoqueVal,
        is_custom: true,
      });
      if (insErr) throw insErr;

      const { error: stErr } = await supabase.from('item_state').insert(
        estoqueVal !== null
          ? { item_id: id, reserved_qty: 0, sold_qty: 0 }
          : { item_id: id, status: 'Disponível' }
      );
      if (stErr) throw stErr;

      return res.status(200).json({ id });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/catalog:', err);
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

function shapeItem(row, state) {
  const isStock = row.estoque !== null && row.estoque !== undefined;
  const base = {
    id: row.id,
    categoria: row.categoria,
    numero: row.numero,
    titulo: row.titulo,
    descricao: row.descricao,
    condicao: row.condicao || null,
    preco: Number(row.preco),
    isCustom: row.is_custom,
  };
  if (isStock) {
    const reserved = state.reserved_qty || 0;
    const sold = state.sold_qty || 0;
    const availableQty = Math.max(0, row.estoque - reserved - sold);
    return { ...base, isStock: true, estoque: row.estoque, availableQty, disponivel: availableQty > 0 };
  }
  const status = state.status || 'Disponível';
  return { ...base, isStock: false, itemStatus: status, disponivel: status === 'Disponível' };
}
