// api/usuarios.js
// Gestão dos usuários cadastrados (Painel Administrativo — exige login de admin).
// GET    /api/usuarios              -> lista os cadastros (com autorizado = CPF está na lista de colaboradores)
// GET/POST /api/usuarios?recurso=limite -> contagem do limite por pessoa (zerar = segunda rodada / restaurar)
// ...    /api/usuarios?recurso=autorizados -> gestão da lista de CPFs autorizados (GET lista, POST cola CPFs,
//                                             PATCH {cpf, ativo}, DELETE &cpf=...) — código em _autorizados.js
// PATCH  /api/usuarios              -> { cpf, acao: 'senha'|'bloquear'|'desbloquear'|'limite', novaSenha?, limite? }
// DELETE /api/usuarios?cpf=...      -> exclui o cadastro

import crypto from 'crypto';
import { getSupabase } from './_supabase.js';
import { requireAdmin } from './_admin.js';
import { cpfsAutorizados, handleAutorizados } from './_autorizados.js';
import { lerVigencia } from './_vigencia.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    const supabase = getSupabase();

    // Lista de colaboradores autorizados (GET/POST/PATCH/DELETE) — ver _autorizados.js
    if (String(req.query.recurso || '') === 'autorizados') {
      return handleAutorizados(req, res, supabase);
    }

    // Contagem do limite por pessoa (config_catalogo.limite_desde):
    // GET  ?recurso=limite                      -> { limiteDesde }
    // POST ?recurso=limite { acao: 'zerar' }    -> só compras a partir de agora contam (segunda rodada)
    // POST ?recurso=limite { acao: 'restaurar' }-> volta a contar todas as compras
    // POST ?recurso=limite { acao: 'categorias', limites: {cat: n} } -> sublimites por categoria
    // POST ?recurso=limite { acao: 'vigencia', modo: 'diario' } -> renova sozinha todo dia às 17h
    // POST ?recurso=limite { acao: 'vigencia', valor: ISO|null } -> data fixa até quando os preços valem
    if (String(req.query.recurso || '') === 'limite') {
      if (req.method === 'GET') {
        const { data, error } = await supabase
          .from('config_catalogo')
          .select('chave, valor')
          .in('chave', ['limite_desde', 'limites_categoria']);
        if (error) throw error;
        const cfg = Object.fromEntries((data || []).map((r) => [r.chave, r.valor]));
        const vigencia = await lerVigencia(supabase);
        let limitesCategoria = {};
        try { limitesCategoria = cfg.limites_categoria ? JSON.parse(cfg.limites_categoria) : {}; } catch { limitesCategoria = {}; }
        return res.status(200).json({
          limiteDesde: cfg.limite_desde || null,
          limitesCategoria,
          precosValidosAte: vigencia.precosValidosAte,
          precosVigenciaModo: vigencia.modo,
          precosDataFixa: vigencia.dataFixa,
        });
      }
      if (req.method === 'POST') {
        const body = parseBody(req);
        const acao = String(body.acao || '');

        // { acao: 'categorias', limites: { Computadores: 1, Monitores: 2 } } -> sublimites por categoria
        // (número vazio/null remove o sublimite da categoria)
        if (acao === 'categorias') {
          const entrada = body.limites && typeof body.limites === 'object' ? body.limites : {};
          const limites = {};
          for (const [cat, v] of Object.entries(entrada)) {
            const nome = String(cat || '').trim();
            if (!nome) continue;
            if (v === null || v === undefined || String(v).trim() === '') continue;
            const n = parseInt(String(v).trim(), 10);
            if (!Number.isInteger(n) || n < 0 || n > 50) {
              return res.status(400).json({ error: `Limite inválido para "${nome}": use um número de 0 a 50, ou deixe em branco.` });
            }
            limites[nome] = n;
          }
          const { error } = await supabase
            .from('config_catalogo')
            .upsert({ chave: 'limites_categoria', valor: JSON.stringify(limites), atualizado_em: new Date().toISOString(), atualizado_por: 'Painel' }, { onConflict: 'chave' });
          if (error) throw error;
          return res.status(200).json({ ok: true, limitesCategoria: limites });
        }

        // { acao: 'vigencia', valor: '2026-09-18T20:00:00.000Z' | null }
        // -> até quando a tabela de preços vale. Aparece no aviso do topo do
        //    catálogo e no rodapé do e-mail de promoção. Vazio = sem prazo.
        if (acao === 'vigencia') {
          const modo = String(body.modo || '') === 'diario' ? 'diario' : 'fixa';
          const bruto = body.valor === null || body.valor === undefined || String(body.valor).trim() === ''
            ? null
            : String(body.valor).trim();
          if (modo === 'fixa' && bruto !== null && Number.isNaN(Date.parse(bruto))) {
            return res.status(400).json({ error: 'Data de vigência inválida.' });
          }
          const registros = [
            { chave: 'precos_vigencia_modo', valor: modo === 'diario' ? 'diario' : null },
          ];
          // No modo diário a data guardada não é usada, mas fica preservada
          // pra quem voltar pro modo fixo não perder o que tinha configurado.
          if (modo === 'fixa') {
            registros.push({ chave: 'precos_validos_ate', valor: bruto === null ? null : new Date(bruto).toISOString() });
          }
          const agora = new Date().toISOString();
          const { error } = await supabase
            .from('config_catalogo')
            .upsert(registros.map((r) => ({ ...r, atualizado_em: agora, atualizado_por: 'Painel' })), { onConflict: 'chave' });
          if (error) throw error;
          const vigencia = await lerVigencia(supabase);
          return res.status(200).json({
            ok: true,
            precosValidosAte: vigencia.precosValidosAte,
            precosVigenciaModo: vigencia.modo,
            precosDataFixa: vigencia.dataFixa,
          });
        }

        if (acao !== 'zerar' && acao !== 'restaurar') return res.status(400).json({ error: 'Ação inválida.' });
        const valor = acao === 'zerar' ? new Date().toISOString() : null;
        const { error } = await supabase
          .from('config_catalogo')
          .upsert({ chave: 'limite_desde', valor, atualizado_em: new Date().toISOString(), atualizado_por: 'Painel' }, { onConflict: 'chave' });
        if (error) throw error;
        return res.status(200).json({ ok: true, limiteDesde: valor });
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Método não permitido.' });
    }

    if (req.method === 'GET') {
      const [{ data: usuarios, error }, autorizados] = await Promise.all([
        supabase
          .from('cadastros_acesso')
          .select('nome, email, cpf, setor, bloqueado, created_at, ultimo_acesso, limite_itens')
          .order('nome', { ascending: true }),
        cpfsAutorizados(supabase),
      ]);
      if (error) throw error;
      // autorizado = CPF está na lista de colaboradores (RH + exceções)
      const lista = (usuarios || []).map((u) => ({ ...u, autorizado: autorizados.has(String(u.cpf)) }));
      return res.status(200).json({ usuarios: lista });
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      const acao = String(body.acao || '');
      if (!cpf) return res.status(400).json({ error: 'Parâmetro "cpf" ausente.' });

      const { data: usuario, error: getErr } = await supabase
        .from('cadastros_acesso')
        .select('cpf')
        .eq('cpf', cpf)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });

      if (acao === 'senha') {
        const novaSenha = String(body.novaSenha || '');
        if (novaSenha.length < 4) {
          return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 4 caracteres.' });
        }
        const { error } = await supabase
          .from('cadastros_acesso')
          .update({ senha_hash: hashPassword(novaSenha) })
          .eq('cpf', cpf);
        if (error) throw error;
        return res.status(200).json({ ok: true, acao });
      }

      // Limite individual de itens (null = volta pro padrão do catálogo)
      if (acao === 'limite') {
        const bruto = body.limite;
        let limite = null;
        if (bruto !== null && bruto !== undefined && String(bruto).trim() !== '') {
          limite = parseInt(String(bruto).trim(), 10);
          if (!Number.isInteger(limite) || limite < 0 || limite > 50) {
            return res.status(400).json({ error: 'Limite inválido: use um número de 0 a 50, ou deixe em branco pra voltar ao padrão.' });
          }
        }
        const { error } = await supabase
          .from('cadastros_acesso')
          .update({ limite_itens: limite })
          .eq('cpf', cpf);
        if (error) throw error;
        return res.status(200).json({ ok: true, acao, limite });
      }

      if (acao === 'bloquear' || acao === 'desbloquear') {
        const { error } = await supabase
          .from('cadastros_acesso')
          .update({ bloqueado: acao === 'bloquear' })
          .eq('cpf', cpf);
        if (error) throw error;
        return res.status(200).json({ ok: true, acao });
      }

      return res.status(400).json({ error: 'Ação inválida.' });
    }

    if (req.method === 'DELETE') {
      const cpf = String(req.query.cpf || '').replace(/\D/g, '');
      if (!cpf) return res.status(400).json({ error: 'Parâmetro "cpf" ausente.' });
      const { error } = await supabase.from('cadastros_acesso').delete().eq('cpf', cpf);
      if (error) throw error;
      return res.status(200).json({ ok: true, removed: true });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/usuarios:', err);
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
