const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  try {
    const { nome, email, cpf } = req.body || {};

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

    const { error } = await supabase
      .from('cadastros_acesso')
      .upsert(
        {
          nome: String(nome).trim(),
          email: String(email).trim().toLowerCase(),
          cpf: cpfLimpo,
          ultimo_acesso: new Date().toISOString(),
        },
        { onConflict: 'cpf' }
      );

    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro ao registrar acesso', err);
    res.status(500).json({ error: 'Não foi possível registrar. Tente novamente.' });
  }
};

