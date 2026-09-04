// api/comprovante.js
// POST /api/comprovante -> associado anexa o comprovante do Pix (imagem ou PDF)
//      { protocolo, matricula (CPF), filename, contentType, dataBase64 }
//      Anexar o comprovante CONFIRMA a venda na hora: status vira 'Concluído',
//      os itens são marcados como vendidos, a Nota de Débito é gerada e enviada
//      por e-mail pra entrada de notas fiscais (com o comprovante junto).
// GET  /api/comprovante?protocolo=AMX-00018             -> admin (com token)
// GET  /api/comprovante?protocolo=AMX-00018&matricula=CPF -> o próprio associado
//      Retorna um link assinado (5 min) para ver o comprovante.

import { getSupabase } from './_supabase.js';
import { verifyToken } from './_admin.js';
import { gerarNdEEmail } from './_concluir.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

const STATUS_FINALIZADOS = ['Concluído', 'Cancelado', 'Reprovado pelo DP'];

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'POST') {
      const body = parseBody(req);
      const protocolo = String(body.protocolo || '').trim();
      const cpfInformado = String(body.matricula || '').replace(/\D/g, '');
      const { filename, contentType, dataBase64 } = body;

      if (!protocolo || !cpfInformado) {
        return res.status(400).json({ error: 'Dados do chamado incompletos.' });
      }
      if (!filename || !contentType || !dataBase64) {
        return res.status(400).json({ error: 'Dados do arquivo incompletos.' });
      }
      if (!contentType.startsWith('image/') && contentType !== 'application/pdf') {
        return res.status(400).json({ error: 'O comprovante precisa ser uma imagem ou PDF.' });
      }

      const { data: chamado, error: getErr } = await supabase
        .from('chamados')
        .select('protocolo, status, matricula, pagamento')
        .eq('protocolo', protocolo)
        .single();
      if (getErr || !chamado) return res.status(404).json({ error: 'Chamado não encontrado.' });
      if (String(chamado.matricula || '').replace(/\D/g, '') !== cpfInformado) {
        return res.status(403).json({ error: 'CPF não confere com o desse chamado.' });
      }
      if (chamado.pagamento !== 'Pix') {
        return res.status(400).json({ error: 'Esse chamado não é de pagamento via Pix.' });
      }
      if (STATUS_FINALIZADOS.includes(chamado.status)) {
        return res.status(409).json({ error: 'Esse chamado já foi finalizado.' });
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      if (buffer.length > 4 * 1024 * 1024) {
        return res.status(413).json({ error: 'Arquivo maior que 4MB. Envie um comprovante menor.' });
      }

      const ext =
        contentType === 'application/pdf'
          ? 'pdf'
          : (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
      const path = `${protocolo}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('comprovantes')
        .upload(path, buffer, { contentType, upsert: false });
      if (upErr) throw upErr;

      // Comprovante anexado -> chamado vai pra conferência da TI. A trava do
      // .eq('status', ...) evita corrida (ex.: admin cancelando ao mesmo tempo).
      const { data: atualizados, error: updErr } = await supabase
        .from('chamados')
        .update({ comprovante_path: path, status: 'Em liberação do Fiscal' })
        .eq('protocolo', protocolo)
        .eq('status', chamado.status)
        .select();
      if (updErr) throw updErr;

      if (!atualizados || !atualizados.length) {
        // status mudou no meio do caminho — só registra o comprovante
        await supabase.from('chamados').update({ comprovante_path: path }).eq('protocolo', protocolo);
        return res.status(200).json({ ok: true, status: chamado.status });
      }

      // gera a ND + e-mail já na hora do comprovante (idempotente)
      const { data: itens, error: itensErr } = await supabase
        .from('chamado_itens')
        .select('*')
        .eq('chamado_protocolo', protocolo);
      if (itensErr) throw itensErr;
      const notaDebitoNumero = await gerarNdEEmail({ supabase, chamado: atualizados[0], itens });

      return res.status(200).json({ ok: true, status: 'Em liberação do Fiscal', notaDebitoNumero });
    }

    if (req.method === 'GET') {
      const protocolo = String(req.query.protocolo || '').trim();
      if (!protocolo) return res.status(400).json({ error: 'Parâmetro "protocolo" ausente.' });

      const { data: chamado, error: getErr } = await supabase
        .from('chamados')
        .select('matricula, comprovante_path')
        .eq('protocolo', protocolo)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!chamado || !chamado.comprovante_path) {
        return res.status(404).json({ error: 'Nenhum comprovante anexado nesse chamado.' });
      }

      // Admin (com token) vê qualquer comprovante; o associado vê o do
      // próprio chamado informando o CPF usado na reserva.
      const auth = req.headers['authorization'] || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const isAdmin = !!(token && verifyToken(token));
      if (!isAdmin) {
        const cpfInformado = String(req.query.matricula || '').replace(/\D/g, '');
        if (!cpfInformado || String(chamado.matricula || '').replace(/\D/g, '') !== cpfInformado) {
          return res.status(403).json({ error: 'CPF não confere com o desse chamado.' });
        }
      }

      const { data: signed, error: signErr } = await supabase.storage
        .from('comprovantes')
        .createSignedUrl(chamado.comprovante_path, 60 * 5); // link válido por 5 minutos
      if (signErr) throw signErr;

      return res.status(200).json({ url: signed.signedUrl });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/comprovante:', err);
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
