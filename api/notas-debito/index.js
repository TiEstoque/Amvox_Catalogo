// api/notas-debito/index.js
// GET /api/notas-debito?protocolo=AMX-00018                    -> admin (com token)
// GET /api/notas-debito?protocolo=AMX-00018&matricula=CPF      -> associado do próprio chamado
// Retorna a ND daquele chamado (numero + link assinado de download), se existir.

import { getSupabase } from '../_supabase.js';
import { verifyToken } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Método não permitido.' });
    }

    const supabase = getSupabase();
    const protocolo = String(req.query.protocolo || '').trim();
    if (!protocolo) return res.status(400).json({ error: 'Parâmetro "protocolo" ausente.' });

    // Admin (com token) baixa qualquer ND; o associado baixa a do próprio
    // chamado informando o CPF usado na reserva.
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const isAdmin = !!(token && verifyToken(token));
    if (!isAdmin) {
      const cpfInformado = String(req.query.matricula || '').replace(/\D/g, '');
      if (!cpfInformado) {
        return res.status(401).json({ error: 'Acesso negado.' });
      }
      const { data: chamadoDono, error: donoErr } = await supabase
        .from('chamados')
        .select('matricula')
        .eq('protocolo', protocolo)
        .maybeSingle();
      if (donoErr) throw donoErr;
      if (!chamadoDono || String(chamadoDono.matricula || '').replace(/\D/g, '') !== cpfInformado) {
        return res.status(403).json({ error: 'CPF não confere com o desse chamado.' });
      }
    }

    const { data: nota, error } = await supabase
      .from('notas_debito')
      .select('*')
      .eq('chamado_protocolo', protocolo)
      .maybeSingle();
    if (error) throw error;
    if (!nota) return res.status(404).json({ error: 'Nenhuma Nota de Débito encontrada para esse chamado.' });

    const { data: signed, error: signErr } = await supabase.storage
      .from('notas-debito')
      .createSignedUrl(nota.arquivo_path, 60 * 5); // link válido por 5 minutos
    if (signErr) throw signErr;

    return res.status(200).json({
      numero: nota.numero,
      dataEmissao: nota.data_emissao,
      valor: Number(nota.valor),
      url: signed.signedUrl,
    });
  } catch (err) {
    console.error('Erro em /api/notas-debito:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}
