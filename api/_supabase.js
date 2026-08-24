// api/_supabase.js
// Client do Supabase usado só no servidor (funções da Vercel).
// Usa a service_role key, que tem acesso total ao banco e NUNCA deve
// ser exposta ao navegador — por isso ela só existe aqui, em variável
// de ambiente do lado do servidor.

import { createClient } from '@supabase/supabase-js';

let client = null;

export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do projeto na Vercel.'
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return client;
}
