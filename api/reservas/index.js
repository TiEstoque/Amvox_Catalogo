// api/reservas/index.js
// GET  /api/reservas?q=texto   -> busca chamados por nome/matrícula ("Meus chamados")
// GET  /api/reservas           -> lista TODOS os chamados (usado pelo Painel Administrativo)
// POST /api/reservas           -> abre uma reserva nova (associado), com vários itens de uma vez

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const q = String(req.query.q || '').trim();

      // Sem filtro de busca = listagem completa (todos os chamados de todo mundo).
      // Isso só o Painel Administrativo pode ver — exige login.
      if (!q) {
        if (!requireAdmin(req, res)) return;
      }

      let query = supabase.from('chamados').select('*').order('data_abertura', { ascending: false });
      if (q) {
        const like = `%${q}%`;
        query = query.or(`nome.ilike.${like},matricula.ilike.${like},setor.ilike.${like}`);
      }
      const { data: chamados, error } = await query;
      if (error) throw error;

      const protocolos = chamados.map((c) => c.protocolo);
      let itensPorChamado = {};
      let descricaoPorItemId = {};
      if (protocolos.length) {
        const { data: itens, error: itensErr } = await supabase
          .from('chamado_itens')
          .select('*')
          .in('chamado_protocolo', protocolos);
        if (itensErr) throw itensErr;
        itens.forEach((it) => {
          (itensPorChamado[it.chamado_protocolo] = itensPorChamado[it.chamado_protocolo] || []).push(it);
        });

        const itemIds = [...new Set(itens.map((it) => it.item_id))];
        if (itemIds.length) {
          const { data: itemsData, error: itemsErr } = await supabase
            .from('items')
            .select('id, descricao')
            .in('id', itemIds);
          if (itemsErr) throw itemsErr;
          itemsData.forEach((it) => { descricaoPorItemId[it.id] = it.descricao; });
        }
      }

      const shaped = chamados.map((c) => shapeChamado(c, itensPorChamado[c.protocolo] || [], descricaoPorItemId));
      return res.status(200).json({ chamados: shaped });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const { nome, matricula, setor, pagamento, itens } = body;

      if (!nome || !matricula || !setor || !pagamento || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Preencha nome, CPF, setor, forma de pagamento e selecione ao menos um item.' });
      }
      // As compras agora são apenas via Pix (pagamento à vista)
      if (pagamento !== 'Pix') {
        return res.status(400).json({ error: 'Forma de pagamento inválida: as compras são apenas via Pix (à vista).' });
      }

      const ids = [...new Set(itens.map((i) => i.itemId))];
      const { data: dbItems, error: itemsErr } = await supabase.from('items').select('*').in('id', ids);
      if (itemsErr) throw itemsErr;
      const { data: states, error: stateErr } = await supabase.from('item_state').select('*').in('item_id', ids);
      if (stateErr) throw stateErr;

      const dbMap = Object.fromEntries(dbItems.map((i) => [i.id, i]));
      const stateMap = Object.fromEntries(states.map((s) => [s.item_id, s]));

      let valorTotal = 0;
      const linhas = [];
      for (const sel of itens) {
        const item = dbMap[sel.itemId];
        if (!item) return res.status(400).json({ error: `Item ${sel.itemId} não encontrado no catálogo.` });
        const isStock = item.estoque !== null && item.estoque !== undefined;
        const qty = Math.max(1, parseInt(sel.quantidade, 10) || 1);
        const state = stateMap[item.id] || {};

        if (isStock) {
          const available = item.estoque - (state.reserved_qty || 0) - (state.sold_qty || 0);
          if (qty > available) {
            return res.status(409).json({
              error: `"${item.titulo}" não tem mais estoque suficiente (restam ${available}). Atualize a página e tente de novo.`,
            });
          }
        } else if ((state.status || 'Disponível') !== 'Disponível') {
          return res.status(409).json({
            error: `"${item.titulo}" (Nº ${item.numero}) já foi reservado por outra pessoa. Atualize a página.`,
          });
        }

        valorTotal += Number(item.preco) * qty;
        linhas.push({ item, qty, isStock });
      }

      // Limite por pessoa (por CPF): máximo 3 itens no total e 2 do mesmo item,
      // somando reservas ativas e compras concluídas (cancelado/reprovado não conta).
      const LIMITE_TOTAL = 3;
      const LIMITE_POR_ITEM = 2;
      const cpfLimpo = String(matricula).replace(/\D/g, '');
      const qtdNova = linhas.reduce((a, l) => a + l.qty, 0);
      if (qtdNova > LIMITE_TOTAL) {
        return res.status(400).json({ error: `Limite por pessoa: no máximo ${LIMITE_TOTAL} itens no total.` });
      }
      for (const l of linhas) {
        if (l.qty > LIMITE_POR_ITEM) {
          return res.status(400).json({ error: `Limite por pessoa: no máximo ${LIMITE_POR_ITEM} unidades de "${l.item.titulo}".` });
        }
      }

      const { data: chamadosPessoa, error: cpErr } = await supabase
        .from('chamados')
        .select('protocolo, matricula, status');
      if (cpErr) throw cpErr;
      const protocolosPessoa = (chamadosPessoa || [])
        .filter((c) => String(c.matricula || '').replace(/\D/g, '') === cpfLimpo)
        .filter((c) => !['Cancelado', 'Reprovado pelo DP'].includes(c.status))
        .map((c) => c.protocolo);

      let qtdExistente = 0;
      const porItemExistente = {};
      if (protocolosPessoa.length) {
        const { data: itensPessoa, error: ipErr } = await supabase
          .from('chamado_itens')
          .select('item_id, quantidade')
          .in('chamado_protocolo', protocolosPessoa);
        if (ipErr) throw ipErr;
        for (const it of itensPessoa || []) {
          qtdExistente += it.quantidade;
          porItemExistente[it.item_id] = (porItemExistente[it.item_id] || 0) + it.quantidade;
        }
      }

      if (qtdExistente + qtdNova > LIMITE_TOTAL) {
        return res.status(400).json({
          error: `Limite por pessoa: no máximo ${LIMITE_TOTAL} itens no total entre reservas e compras — você já tem ${qtdExistente}. Dúvidas? Procure a TI.`,
        });
      }
      for (const l of linhas) {
        const jaTem = porItemExistente[l.item.id] || 0;
        if (jaTem + l.qty > LIMITE_POR_ITEM) {
          return res.status(400).json({
            error: `Limite por pessoa: no máximo ${LIMITE_POR_ITEM} unidades de "${l.item.titulo}" — você já tem ${jaTem}.`,
          });
        }
      }

      const parcelasNum = null;
      const valorParcela = null;
      const status = 'Aguardando pagamento Pix';

      const { data: chamadoRow, error: chErr } = await supabase
        .from('chamados')
        .insert({
          nome,
          matricula,
          setor,
          valor_total: valorTotal,
          pagamento,
          parcelas: parcelasNum,
          valor_parcela: valorParcela,
          status,
        })
        .select()
        .single();
      if (chErr) throw chErr;
      const protocolo = chamadoRow.protocolo;

      const itensInsert = linhas.map((l) => ({
        chamado_protocolo: protocolo,
        item_id: l.item.id,
        numero: l.item.numero,
        titulo: l.item.titulo,
        categoria: l.item.categoria,
        preco: l.item.preco,
        quantidade: l.qty,
        is_stock: l.isStock,
      }));
      const { error: itensInsErr } = await supabase.from('chamado_itens').insert(itensInsert);
      if (itensInsErr) throw itensInsErr;

      // marca os itens como reservados
      for (const l of linhas) {
        if (l.isStock) {
          const state = stateMap[l.item.id];
          if (state) {
            await supabase
              .from('item_state')
              .update({ reserved_qty: (state.reserved_qty || 0) + l.qty, updated_at: new Date().toISOString() })
              .eq('item_id', l.item.id);
          } else {
            await supabase.from('item_state').insert({ item_id: l.item.id, reserved_qty: l.qty });
          }
        } else {
          await supabase
            .from('item_state')
            .upsert({ item_id: l.item.id, status: 'Reservado', updated_at: new Date().toISOString() });
        }
      }

      return res.status(200).json({
        protocolo,
        status,
        valorTotal,
        nome,
        matricula,
        setor,
        pagamento,
        parcelas: parcelasNum,
        valorParcela,
        dataAbertura: new Date().toISOString(),
        itens: linhas.map((l) => ({
          itemId: l.item.id,
          numero: l.item.numero,
          titulo: l.item.titulo,
          descricao: l.item.descricao,
          categoria: l.item.categoria,
          preco: l.item.preco,
          quantidade: l.qty,
        })),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/reservas:', err);
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

function shapeChamado(c, itens, descricaoPorItemId = {}) {
  return {
    protocolo: c.protocolo,
    nome: c.nome,
    matricula: c.matricula,
    setor: c.setor,
    valorTotal: Number(c.valor_total),
    pagamento: c.pagamento,
    parcelas: c.parcelas,
    valorParcela: c.valor_parcela !== null ? Number(c.valor_parcela) : null,
    status: c.status,
    observacaoDP: c.observacao_dp,
    temComprovante: !!c.comprovante_path,
    dataAbertura: c.data_abertura,
    itens: itens.map((it) => ({
      itemId: it.item_id,
      numero: it.numero,
      titulo: it.titulo,
      descricao: descricaoPorItemId[it.item_id] || '',
      categoria: it.categoria,
      preco: Number(it.preco),
      quantidade: it.quantidade,
      isStock: it.is_stock,
    })),
  };
}
