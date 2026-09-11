// api/_vigencia.js
// Vigência da tabela de preços do Catálogo de Vendas Internas.
//
// config_catalogo.precos_vigencia_modo:
//   'diario' -> a tabela vale até as 17h00 de HOJE e a data vira sozinha todo
//               dia, sem ninguém precisar mexer no Painel;
//   'fixa' (ou ausente) -> usa a data gravada em precos_validos_ate.
//
// Depois das 17h00 a vigência do dia fica vencida de propósito: o catálogo
// mostra "tabela em revisão" até virar o dia. É nessa janela que a TI mexe
// nos preços — quem compra das 07h00 às 17h00 tem o preço garantido do dia,
// que é o que a Nota de Débito assinada registra.

export const HORA_INICIO_VIGENCIA = 7;   // 07h00 (só aparece no texto da ND)
export const HORA_FIM_VIGENCIA = 17;     // 17h00

// "Hoje às 17h00" no horário da Bahia. A data do dia vem do Intl (sempre
// certa); o fuso -03:00 é fixo porque a Bahia não tem horário de verão.
export function fimDoDiaVigente(agora = new Date()) {
  const [dia, mes, ano] = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric',
  })
    .format(agora)
    .split('/');
  const hora = String(HORA_FIM_VIGENCIA).padStart(2, '0');
  return new Date(`${ano}-${mes}-${dia}T${hora}:00:00-03:00`);
}

// Lê o modo e devolve a vigência que está valendo agora.
// -> { modo, precosValidosAte (ISO|null), dataFixa (ISO|null) }
export async function lerVigencia(supabase) {
  const { data, error } = await supabase
    .from('config_catalogo')
    .select('chave, valor')
    .in('chave', ['precos_validos_ate', 'precos_vigencia_modo']);
  if (error) throw error;
  const cfg = Object.fromEntries((data || []).map((r) => [r.chave, r.valor]));
  const modo = cfg.precos_vigencia_modo === 'diario' ? 'diario' : 'fixa';
  return {
    modo,
    precosValidosAte: modo === 'diario' ? fimDoDiaVigente().toISOString() : cfg.precos_validos_ate || null,
    dataFixa: cfg.precos_validos_ate || null,
  };
}

// Só a data/hora vigente — atalho pra quem não precisa do modo.
export async function vigenciaAtual(supabase) {
  return (await lerVigencia(supabase)).precosValidosAte;
}
