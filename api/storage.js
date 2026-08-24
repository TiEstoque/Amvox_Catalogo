// api/storage.js
// Backend de armazenamento do catálogo Amvox, rodando como Vercel Serverless Function.
// Usa Upstash Redis (integração "Storage" do Vercel Marketplace) como banco de dados
// chave-valor, substituindo o window.storage do Claude Artifacts.
//
// Variáveis de ambiente esperadas (injetadas automaticamente ao conectar a
// integração Upstash Redis pelo painel da Vercel):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  automaticDeserialization: false, // guardamos e lemos sempre como string (JSON já vem pronto do front-end)
});

// Todas as chaves do app ficam sob esse prefixo, pra não colidir com outras
// coisas que porventura usem o mesmo banco Redis.
const PREFIX = 'amvox:';

// Só aceita chaves “seguras” (letras, números, : _ -), iguais ao padrão usado
// no front-end (amvox_chamados_v2, amvox_item_state_v1, etc).
const KEY_PATTERN = /^[a-zA-Z0-9:_-]{1,200}$/;

export default async function handler(req, res) {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return res.status(500).json({
        error: 'Banco de dados não configurado. Conecte uma integração Redis (Upstash) ao projeto na Vercel.',
      });
    }

    if (req.method === 'GET') {
      // Listagem por prefixo: /api/storage?list=1&prefix=amvox_
      if (req.query.list) {
        const prefix = String(req.query.prefix || '');
        const pattern = `${PREFIX}${prefix}*`;
        const rawKeys = await redis.keys(pattern);
        const keys = rawKeys.map((k) => k.slice(PREFIX.length));
        return res.status(200).json({ keys });
      }

      const key = req.query.key;
      if (!key || !KEY_PATTERN.test(key)) {
        return res.status(400).json({ error: 'Parâmetro "key" ausente ou inválido.' });
      }
      const value = await redis.get(`${PREFIX}${key}`);
      if (value === null || value === undefined) {
        return res.status(404).json({ error: 'not found' });
      }
      return res.status(200).json({ key, value });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { key, value } = body;
      if (!key || !KEY_PATTERN.test(key)) {
        return res.status(400).json({ error: 'Parâmetro "key" ausente ou inválido.' });
      }
      if (typeof value !== 'string') {
        return res.status(400).json({ error: '"value" precisa ser uma string (o front-end já envia JSON.stringify).' });
      }
      if (value.length > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'Valor maior que 5MB.' });
      }
      await redis.set(`${PREFIX}${key}`, value);
      return res.status(200).json({ key, value });
    }

    if (req.method === 'DELETE') {
      const key = req.query.key;
      if (!key || !KEY_PATTERN.test(key)) {
        return res.status(400).json({ error: 'Parâmetro "key" ausente ou inválido.' });
      }
      await redis.del(`${PREFIX}${key}`);
      return res.status(200).json({ key, deleted: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/storage:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}
