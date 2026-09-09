// api/_autorizados.js
// Lista de CPFs autorizados a usar o catálogo (tabela colaboradores_autorizados):
// relação de colaboradores do RH + exceções liberadas pela TI no Painel.
// Usado pelo cadastro (novo cadastro só com CPF autorizado), pela promoção
// por e-mail (só vai pra quem está na lista) e pela tela de usuários.
//
// A gestão da lista (listar, colar CPFs, desativar, remover) fica em
// handleAutorizados(), chamada por /api/usuarios?recurso=autorizados — não é
// uma função própria porque o plano Hobby da Vercel limita a 12 funções por
// deploy e o projeto já usa as 12.

// Devolve um Set com os CPFs ativos da lista.
export async function cpfsAutorizados(supabase) {
  const { data, error } = await supabase
    .from('colaboradores_autorizados')
    .select('cpf')
    .eq('ativo', true);
  if (error) throw error;
  return new Set((data || []).map((r) => String(r.cpf)));
}

export async function cpfAutorizado(supabase, cpf) {
  const limpo = String(cpf || '').replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  const { data, error } = await supabase
    .from('colaboradores_autorizados')
    .select('cpf')
    .eq('cpf', limpo)
    .eq('ativo', true)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function handleAutorizados(req, res, supabase) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('colaboradores_autorizados')
        .select('cpf, nome, chapa, origem, observacao, ativo, created_at')
        .order('nome', { ascending: true });
      if (error) throw error;
      const lista = data || [];
      const porOrigem = {};
      lista.forEach((r) => {
        if (!r.ativo) return;
        porOrigem[r.origem] = (porOrigem[r.origem] || 0) + 1;
      });
      return res.status(200).json({
        total: lista.length,
        ativos: lista.filter((r) => r.ativo).length,
        porOrigem,
        lista,
      });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const observacao = String(body.observacao || '').trim() || null;
      const origem = String(body.origem || '').trim() === 'RH' ? 'RH' : 'Exceção';
      const linhas = String(body.texto || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (!linhas.length) return res.status(400).json({ error: 'Cole pelo menos um CPF (um por linha).' });

      const registros = new Map();
      const invalidos = [];
      for (const linha of linhas) {
        const { cpf, nome } = separarCpfNome(linha);
        if (cpf.length !== 11) {
          invalidos.push(linha);
          continue;
        }
        registros.set(cpf, { cpf, nome: nome || null });
      }
      if (!registros.size) {
        return res.status(400).json({ error: 'Nenhum CPF válido encontrado (precisa ter 11 dígitos).', invalidos });
      }

      const cpfs = [...registros.keys()];
      const { data: existentes, error: exErr } = await supabase
        .from('colaboradores_autorizados')
        .select('cpf, nome')
        .in('cpf', cpfs);
      if (exErr) throw exErr;
      const jaTem = new Map((existentes || []).map((r) => [r.cpf, r]));

      const agora = new Date().toISOString();
      const upserts = cpfs.map((cpf) => {
        const r = registros.get(cpf);
        const antigo = jaTem.get(cpf);
        return {
          cpf,
          nome: r.nome || (antigo ? antigo.nome : null),
          origem,
          observacao,
          ativo: true,
          updated_at: agora,
        };
      });
      const { error: upErr } = await supabase
        .from('colaboradores_autorizados')
        .upsert(upserts, { onConflict: 'cpf' });
      if (upErr) throw upErr;

      return res.status(200).json({
        inseridos: cpfs.filter((c) => !jaTem.has(c)).length,
        atualizados: cpfs.filter((c) => jaTem.has(c)).length,
        invalidos,
      });
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const cpf = String(body.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido.' });
      const { error } = await supabase
        .from('colaboradores_autorizados')
        .update({ ativo: body.ativo !== false, updated_at: new Date().toISOString() })
        .eq('cpf', cpf);
      if (error) throw error;
      return res.status(200).json({ ok: true, cpf, ativo: body.ativo !== false });
    }

    if (req.method === 'DELETE') {
      const cpf = String(req.query.cpf || '').replace(/\D/g, '');
      if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido.' });
      const { error } = await supabase.from('colaboradores_autorizados').delete().eq('cpf', cpf);
      if (error) throw error;
      return res.status(200).json({ ok: true, removed: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/usuarios?recurso=autorizados:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}

// "039.642.045-10", "03964204510;NOME", "03964204510, NOME", "03964204510 NOME"
// ou "NOME;03964204510" -> { cpf: '03964204510', nome: 'NOME' }
function separarCpfNome(linha) {
  const m = linha.match(/^([\d.\-]+)/);
  if (m && m[1].replace(/\D/g, '').length === 11) {
    const nome = linha.slice(m[1].length).replace(/^[\s;,\t\-–]+/, '').trim();
    return { cpf: m[1].replace(/\D/g, ''), nome };
  }
  const digitos = linha.replace(/\D/g, '');
  if (digitos.length === 11) {
    const nome = linha.replace(/[\d.\-]+/g, ' ').replace(/[;,\t]/g, ' ').replace(/\s+/g, ' ').trim();
    return { cpf: digitos, nome };
  }
  return { cpf: digitos, nome: '' };
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
