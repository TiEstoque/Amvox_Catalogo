// api/usuarios.js
// Gestão dos usuários cadastrados (Painel Administrativo — exige login de admin).
// GET    /api/usuarios              -> lista os cadastros
// PATCH  /api/usuarios              -> { cpf, acao: 'senha'|'bloquear'|'desbloquear', novaSenha? }
// DELETE /api/usuarios?cpf=...      -> exclui o cadastro

import crypto from 'crypto';
import { getSupabase } from './_supabase.js';
import { requireAdmin } from './_admin.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data: usuarios, error } = await supabase
        .from('cadastros_acesso')
        .select('nome, email, cpf, setor, bloqueado, created_at, ultimo_acesso')
        .order('nome', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ usuarios });
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
