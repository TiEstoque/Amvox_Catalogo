// api/notas-debito/index.js
// GET /api/notas-debito?protocolo=AMX-00018  -> retorna a ND daquele chamado
//     (numero + link assinado de download), se existir. Só admin.

import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Método não permitido.' });
    }

    const supabase = getSupabase();
    const protocolo = String(req.query.protocolo || '').trim();
    if (!protocolo) return res.status(400).json({ error: 'Parâmetro "protocolo" ausente.' });

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
