// api/reservas/index.js
// GET  /api/reservas?q=texto   -> busca chamados por nome/matrícula ("Meus chamados")
// GET  /api/reservas           -> lista TODOS os chamados (usado pelo Painel Administrativo)
// POST /api/reservas           -> abre uma reserva nova (associado), com vários itens
//      de uma vez. O comprovante do Pix é OBRIGATÓRIO no corpo — sem ele a
//      reserva nem é criada; com ele, a compra já nasce confirmada (Concluído),
//      com Nota de Débito gerada e enviada por e-mail.

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';
import { gerarNdEEmail } from '../_concluir.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      // GET /api/reservas?saldoCpf=CPF -> quantos itens a pessoa ainda pode
      // comprar (limite por pessoa). Usado pelo modal de reserva pra evitar
      // que alguém pague o Pix sem ter saldo.
      const saldoCpf = String(req.query.saldoCpf || '').replace(/\D/g, '');
      if (saldoCpf) {
        const LIMITE = 4;
        const { data: chamadosPessoa, error: cpErr } = await supabase
          .from('chamados')
          .select('protocolo, matricula, status');
        if (cpErr) throw cpErr;
        const protocolosPessoa = (chamadosPessoa || [])
          .filter((c) => String(c.matricula || '').replace(/\D/g, '') === saldoCpf)
          .filter((c) => !['Cancelado', 'Reprovado pelo DP'].includes(c.status))
          .map((c) => c.protocolo);
        let usados = 0;
        if (protocolosPessoa.length) {
          const { data: itensPessoa, error: ipErr } = await supabase
            .from('chamado_itens')
            .select('quantidade')
            .in('chamado_protocolo', protocolosPessoa);
          if (ipErr) throw ipErr;
          usados = (itensPessoa || []).reduce((a, it) => a + it.quantidade, 0);
        }
        return res.status(200).json({ limite: LIMITE, usados, disponivel: Math.max(0, LIMITE - usados) });
      }

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

      // Trava: só reserva com o comprovante do Pix anexado — a reserva já
      // nasce paga e confirmada.
      const cmp = body.comprovante || {};
      if (!cmp.filename || !cmp.contentType || !cmp.dataBase64) {
        return res.status(400).json({ error: 'Anexe o comprovante do Pix para confirmar a reserva.' });
      }
      if (!cmp.contentType.startsWith('image/') && cmp.contentType !== 'application/pdf') {
        return res.status(400).json({ error: 'O comprovante precisa ser uma imagem ou PDF.' });
      }
      const cmpBuffer = Buffer.from(cmp.dataBase64, 'base64');
      if (cmpBuffer.length > 4 * 1024 * 1024) {
        return res.status(413).json({ error: 'Comprovante maior que 4MB. Envie um arquivo menor.' });
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

      // Limite: máximo 4 itens por pessoa (por CPF), somando reservas ativas e
      // compras concluídas — sair e reservar de novo não burla o limite.
      // Chamado cancelado/reprovado/expirado devolve o direito.
      const LIMITE_POR_PESSOA = 4;
      const cpfLimpo = String(matricula).replace(/\D/g, '');
      const qtdNova = linhas.reduce((a, l) => a + l.qty, 0);
      if (qtdNova > LIMITE_POR_PESSOA) {
        return res.status(400).json({ error: `Limite: no máximo ${LIMITE_POR_PESSOA} itens por pessoa.` });
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
      if (protocolosPessoa.length) {
        const { data: itensPessoa, error: ipErr } = await supabase
          .from('chamado_itens')
          .select('quantidade')
          .in('chamado_protocolo', protocolosPessoa);
        if (ipErr) throw ipErr;
        qtdExistente = (itensPessoa || []).reduce((a, it) => a + it.quantidade, 0);
      }

      if (qtdExistente + qtdNova > LIMITE_POR_PESSOA) {
        return res.status(400).json({
          error: `Limite de ${LIMITE_POR_PESSOA} itens por pessoa: você já tem ${qtdExistente} entre reservas e compras. Dúvidas? Procure a TI.`,
        });
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

      // Comprovante veio junto -> gera a ND + e-mail na hora e o chamado vai
      // pra conferência da TI (itens segurados). O admin confere e clica em
      // "Concluir venda" só pra finalizar (marcar vendido) e liberar a entrega.
      let statusFinal = status;
      let notaDebitoNumero = null;
      try {
        const ext =
          cmp.contentType === 'application/pdf'
            ? 'pdf'
            : (cmp.contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
        const cmpPath = `${protocolo}-${Date.now()}.${ext}`;
        const { error: cmpUpErr } = await supabase.storage
          .from('comprovantes')
          .upload(cmpPath, cmpBuffer, { contentType: cmp.contentType, upsert: false });
        if (cmpUpErr) throw cmpUpErr;

        const { error: updErr } = await supabase
          .from('chamados')
          .update({ comprovante_path: cmpPath, status: 'Aguardando conferência da TI' })
          .eq('protocolo', protocolo);
        if (updErr) throw updErr;
        statusFinal = 'Aguardando conferência da TI';

        notaDebitoNumero = await gerarNdEEmail({
          supabase,
          chamado: {
            protocolo,
            nome,
            matricula,
            setor,
            valor_total: valorTotal,
            pagamento: 'Pix',
            comprovante_path: cmpPath,
          },
          itens: linhas.map((l) => ({
            item_id: l.item.id,
            numero: l.item.numero,
            titulo: l.item.titulo,
            quantidade: l.qty,
            is_stock: l.isStock,
          })),
        });
      } catch (confErr) {
        // reserva existe e itens estão segurados; o associado pode reanexar
        // o comprovante em "Meus chamados"
        console.error('Reserva', protocolo, 'criada, mas o envio do comprovante falhou:', confErr);
      }

      return res.status(200).json({
        protocolo,
        status: statusFinal,
        notaDebitoNumero,
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
    entregueEm: c.entregue_em || null,
    entregueObs: c.entregue_obs || null,
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
