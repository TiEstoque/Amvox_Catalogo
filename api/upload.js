// api/upload.js
// POST /api/upload  -> recebe uma imagem (base64) e guarda no Supabase Storage
// (bucket "produtos"), devolvendo a URL pública pra salvar no item.

import { getSupabase } from './_supabase.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método não permitido.' });
    }

    const supabase = getSupabase();
    const body = parseBody(req);
    const { filename, contentType, dataBase64 } = body;

    if (!filename || !contentType || !dataBase64) {
      return res.status(400).json({ error: 'Dados da imagem incompletos.' });
    }
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'O arquivo precisa ser uma imagem.' });
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'Imagem maior que 5MB. Escolha uma foto menor.' });
    }

    const ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40);
    const path = `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}.${ext}`;

    const { error: upErr } = await supabase.storage.from('produtos').upload(path, buffer, {
      contentType,
      upsert: false,
    });
    if (upErr) throw upErr;

    const { data } = supabase.storage.from('produtos').getPublicUrl(path);
    return res.status(200).json({ url: data.publicUrl });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
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
