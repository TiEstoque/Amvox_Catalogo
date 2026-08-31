const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashToCheck = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashToCheck, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  try {
    const { nome, email, cpf, senha, aceiteTermos } = req.body || {};

    const cpfLimpo = String(cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      res.status(400).json({ error: 'CPF inválido. Digite os 11 números.' });
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) {
      res.status(400).json({ error: 'Email inválido.' });
      return;
    }
    if (!nome || String(nome).trim().length < 2) {
      res.status(400).json({ error: 'Digite o nome completo.' });
      return;
    }
    if (!senha || String(senha).length < 4) {
      res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });
      return;
    }
    if (aceiteTermos !== true) {
      res.status(400).json({ error: 'É necessário aceitar os Termos e Condições para continuar.' });
      return;
    }

    const { data: existing, error: selErr } = await supabase
      .from('cadastros_acesso')
      .select('senha_hash')
      .eq('cpf', cpfLimpo)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      // CPF já cadastrado -> precisa bater a senha
      if (!verifyPassword(senha, existing.senha_hash)) {
        res.status(401).json({ error: 'Senha incorreta para esse CPF. Se esqueceu, procure a TI.' });
        return;
      }
      const { error } = await supabase
        .from('cadastros_acesso')
        .update({
          nome: String(nome).trim(),
          email: String(email).trim().toLowerCase(),
          aceite_termos: true,
          aceite_termos_em: new Date().toISOString(),
          ultimo_acesso: new Date().toISOString(),
        })
        .eq('cpf', cpfLimpo);
      if (error) throw error;
    } else {
      // primeiro acesso desse CPF -> cria a senha
      const { error } = await supabase.from('cadastros_acesso').insert({
        nome: String(nome).trim(),
        email: String(email).trim().toLowerCase(),
        cpf: cpfLimpo,
        senha_hash: hashPassword(String(senha)),
        aceite_termos: true,
        aceite_termos_em: new Date().toISOString(),
      });
      if (error) throw error;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro ao registrar acesso', err);
    res.status(500).json({ error: 'Não foi possível registrar. Tente novamente.' });
  }
};
