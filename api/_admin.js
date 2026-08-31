// api/_admin.js
// Autenticação do Painel Administrativo.
// A senha de verdade mora SÓ na variável de ambiente ADMIN_PASSWORD (Vercel),
// nunca no index.html nem em qualquer código que roda no navegador.
// Emite um token assinado (HMAC-SHA256) com validade de algumas horas;
// as rotas administrativas exigem esse token antes de qualquer ação.

import crypto from 'crypto';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function getSecret() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error(
      'ADMIN_PASSWORD não configurada. Defina essa variável de ambiente no projeto na Vercel.'
    );
  }
  return secret;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkPassword(password) {
  return safeEqual(String(password || ''), getSecret());
}

export function issueToken() {
  const secret = getSecret();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', secret).update(String(expiresAt)).digest('hex');
  return Buffer.from(`${expiresAt}.${sig}`).toString('base64url');
}

export function verifyToken(token) {
  try {
    const secret = getSecret();
    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const [expiresAtStr, sig] = decoded.split('.');
    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || !sig) return false;
    if (Date.now() > expiresAt) return false;
    const expectedSig = crypto.createHmac('sha256', secret).update(String(expiresAt)).digest('hex');
    return safeEqual(sig, expectedSig);
  } catch {
    return false;
  }
}

// Use no topo de qualquer rota que só o admin pode chamar.
// Retorna true se autorizado; se não, já envia a resposta 401 e retorna false
// (o handler só precisa dar `return` quando isso acontecer).
export function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'Acesso negado. Faça login no Painel Administrativo novamente.' });
    return false;
  }
  return true;
}
