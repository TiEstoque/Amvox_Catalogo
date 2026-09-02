// api/notas-debito/regerar.js
// POST /api/notas-debito/regerar -> reemite as NDs já existentes acrescentando
// nome + CPF do pagador (admin). Endpoint temporário: as NDs emitidas antes da
// mudança de 02/09/2026 saíram só com o nome; isto conserta os arquivos no
// Storage sem mudar número, itens ou valores. Idempotente — o campo é sempre
// reconstruído a partir de chamados.nome + chamados.matricula.

import ExcelJS from 'exceljs';
import { getSupabase } from '../_supabase.js';
import { requireAdmin } from '../_admin.js';
import { formatarCpf } from '../_notadebito.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método não permitido.' });
    }
    if (!requireAdmin(req, res)) return;

    const supabase = getSupabase();

    const { data: nds, error: ndsErr } = await supabase
      .from('notas_debito')
      .select('numero, chamado_protocolo, pagador, arquivo_path')
      .order('numero');
    if (ndsErr) throw ndsErr;

    const resultados = [];
    for (const nd of nds || []) {
      try {
        const { data: chamado, error: chErr } = await supabase
          .from('chamados')
          .select('nome, matricula')
          .eq('protocolo', nd.chamado_protocolo)
          .maybeSingle();
        if (chErr) throw chErr;

        const cpf = formatarCpf(chamado?.matricula);
        if (!cpf) {
          resultados.push({ numero: nd.numero, pulada: 'chamado sem CPF' });
          continue;
        }
        const nome = chamado?.nome || nd.pagador;
        const pagadorComCpf = `${nome} — CPF: ${cpf}`;

        const { data: arquivo, error: dlErr } = await supabase.storage
          .from('notas-debito')
          .download(nd.arquivo_path);
        if (dlErr) throw dlErr;

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(Buffer.from(await arquivo.arrayBuffer()));
        const params = wb.getWorksheet('PARAMETROS');
        const ndSheet = wb.getWorksheet('ND');
        const controle = wb.getWorksheet('CONTROLE');
        if (!params || !ndSheet || !controle) throw new Error('abas do modelo não encontradas no arquivo');

        params.getCell('B8').value = pagadorComCpf;
        ndSheet.getCell('A9').value = `Pagador: ${pagadorComCpf}`;
        controle.eachRow((row) => {
          if (Number(row.getCell(1).value) === Number(nd.numero)) {
            row.getCell(3).value = pagadorComCpf;
          }
        });

        const buffer = await wb.xlsx.writeBuffer();
        const { error: upErr } = await supabase.storage
          .from('notas-debito')
          .upload(nd.arquivo_path, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true,
          });
        if (upErr) throw upErr;

        resultados.push({ numero: nd.numero, ok: true });
      } catch (err) {
        resultados.push({ numero: nd.numero, erro: err.message });
      }
    }

    const ok = resultados.filter((r) => r.ok).length;
    const erros = resultados.filter((r) => r.erro);
    return res.status(200).json({ total: resultados.length, reemitidas: ok, erros, resultados });
  } catch (err) {
    console.error('Erro em /api/notas-debito/regerar:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}
