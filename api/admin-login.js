// api/admin-login.js
// POST /api/admin-login { password } -> { token }
// A senha real fica só na variável de ambiente ADMIN_PASSWORD (Vercel) —
// nunca aparece no código que roda no navegador.

import { checkPassword, issueToken } from './_admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  try {
    const body = parseBody(req);
    const { password } = body;

    if (!checkPassword(password)) {
      // pequeno atraso proposital, dificulta tentativa por força bruta
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).json({ error: 'Código inválido.' });
    }

    const token = issueToken();
    return res.status(200).json({ token });
  } catch (err) {
    console.error('Erro em /api/admin-login:', err);
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
