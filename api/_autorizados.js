// api/_autorizados.js
// Lista de CPFs autorizados a usar o catálogo (tabela colaboradores_autorizados):
// relação de colaboradores do RH + exceções liberadas pela TI no Painel.
// Usado pelo cadastro (novo cadastro só com CPF autorizado), pela promoção
// por e-mail (só vai pra quem está na lista) e pela tela de usuários.

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
