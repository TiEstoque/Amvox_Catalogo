// api/promocao.js
// Disparo de e-mail de promoção pra todos os cadastrados do catálogo
// (Painel Administrativo → aba Promoção). Exige login de admin.
//
// GET  /api/promocao?publico=todos|sem_compra
//      -> { total, destinatarios: [e-mails], emailConfigurado, remetente }
//         (cadastros não bloqueados e com CPF na lista de colaboradores
//          autorizados, sem e-mail repetido)
//
// POST /api/promocao { assunto, mensagem, teste: 'email' }
//      -> envia SÓ um teste pro e-mail informado (vazio = remetente do catálogo)
//
// POST /api/promocao { assunto, mensagem, destinatarios: [e-mails], publico? }
//      -> envia pro lote informado (máx. LOTE_MAX por chamada). Só aceita
//         e-mails que estão em cadastros_acesso e não bloqueados — assim a
//         rota nunca vira um "disparador" pra endereços de fora.
//
// O front-end divide a lista em lotes e chama o POST várias vezes, mostrando
// o progresso — cada chamada fica curta e não estoura o tempo da função.
// A mensagem é texto simples; aqui ela vira também um HTML com o visual do
// catálogo e um botão "Ver o catálogo". Cada envio fica em email_logs.

import { getSupabase } from './_supabase.js';
import { requireAdmin } from './_admin.js';
import { enviarEmail, emailConfigurado } from './_email.js';
import { cpfsAutorizados } from './_autorizados.js';

const LOTE_MAX = 20;      // destinatários por chamada
const PARALELOS = 5;      // envios simultâneos (Gmail não gosta de muitos de uma vez)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const publico = String(req.query.publico || 'todos');
      const destinatarios = await listarDestinatarios(supabase, publico);
      return res.status(200).json({
        publico,
        total: destinatarios.length,
        destinatarios,
        emailConfigurado: emailConfigurado(),
        remetente: process.env.EMAIL_REMETENTE || null,
      });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const assunto = String(body.assunto || '').trim();
      const mensagem = String(body.mensagem || '').trim();
      if (!assunto) return res.status(400).json({ error: 'Informe o assunto do e-mail.' });
      if (!mensagem) return res.status(400).json({ error: 'Escreva a mensagem da promoção.' });
      if (!emailConfigurado()) {
        return res.status(400).json({
          error: 'E-mail não configurado na Vercel (EMAIL_REMETENTE e EMAIL_SENHA_APP).',
        });
      }

      const host = req.headers['x-forwarded-host'] || req.headers.host || 'amvox.vercel.app';
      const siteUrl = process.env.SITE_URL || `https://${host}`;
      const vigencia = fmtVigencia(await vigenciaPrecos(supabase));
      const conteudo = montarConteudo({ assunto, mensagem, siteUrl, vigencia });

      // ---- Teste: um único e-mail, pra conferir como ficou ----
      if (body.teste !== undefined) {
        const destino =
          String(body.teste || '').trim().toLowerCase() ||
          String(process.env.EMAIL_REMETENTE || '').trim().toLowerCase();
        if (!EMAIL_RE.test(destino)) return res.status(400).json({ error: 'E-mail de teste inválido.' });
        await enviarEmail({
          para: destino,
          assunto: '[TESTE] ' + assunto,
          texto: conteudo.texto,
          html: conteudo.html,
          anexos: [],
        });
        return res.status(200).json({ teste: true, destino });
      }

      // ---- Lote de destinatários ----
      const pedidos = Array.isArray(body.destinatarios)
        ? body.destinatarios.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
        : [];
      if (!pedidos.length) return res.status(400).json({ error: 'Nenhum destinatário informado.' });
      if (pedidos.length > LOTE_MAX) {
        return res.status(400).json({ error: `Envie no máximo ${LOTE_MAX} destinatários por chamada.` });
      }

      const publico = String(body.publico || 'todos');
      const permitidos = new Set(await listarDestinatarios(supabase, publico));
      const unicos = [...new Set(pedidos)];
      const validos = unicos.filter((e) => permitidos.has(e));
      const ignorados = unicos.filter((e) => !permitidos.has(e));

      let enviados = 0;
      const erros = [];
      for (let i = 0; i < validos.length; i += PARALELOS) {
        const grupo = validos.slice(i, i + PARALELOS);
        const resultados = await Promise.allSettled(
          grupo.map((para) =>
            enviarEmail({ para, assunto, texto: conteudo.texto, html: conteudo.html, anexos: [] })
          )
        );
        resultados.forEach((r, j) => {
          if (r.status === 'fulfilled') enviados++;
          else erros.push({ email: grupo[j], erro: String((r.reason && r.reason.message) || r.reason) });
        });
      }

      return res.status(200).json({ enviados, erros, ignorados });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/promocao:', err);
    return res.status(500).json({ error: 'Erro interno.', message: err.message });
  }
}

// Cadastros não bloqueados E com CPF na lista de colaboradores autorizados;
// e-mails em minúsculas e sem repetição. publico = 'todos' ou 'sem_compra'
// (só quem nunca teve reserva/compra válida — chamados cancelados/reprovados
// não contam).
async function listarDestinatarios(supabase, publico = 'todos') {
  const [{ data, error }, autorizados, compradores] = await Promise.all([
    supabase
      .from('cadastros_acesso')
      .select('email, cpf')
      .eq('bloqueado', false)
      .order('email', { ascending: true }),
    cpfsAutorizados(supabase),
    publico === 'sem_compra' ? cpfsQueCompraram(supabase) : Promise.resolve(new Set()),
  ]);
  if (error) throw error;
  const vistos = new Set();
  for (const u of data || []) {
    if (!autorizados.has(String(u.cpf))) continue;
    if (publico === 'sem_compra' && compradores.has(String(u.cpf))) continue;
    const e = String(u.email || '').trim().toLowerCase();
    if (e && EMAIL_RE.test(e)) vistos.add(e);
  }
  return [...vistos];
}

// CPFs com pelo menos um chamado válido (reserva ou compra).
async function cpfsQueCompraram(supabase) {
  const { data, error } = await supabase
    .from('chamados')
    .select('matricula, status')
    .not('status', 'in', '("Cancelado","Reprovado pelo DP")');
  if (error) throw error;
  return new Set((data || []).map((c) => String(c.matricula || '').replace(/\D/g, '')).filter(Boolean));
}

// Vigência da tabela de preços (config_catalogo.precos_validos_ate): vai no
// rodapé do e-mail, pra ninguém comprar achando que o valor muda no mesmo dia.
async function vigenciaPrecos(supabase) {
  const { data, error } = await supabase
    .from('config_catalogo')
    .select('valor')
    .eq('chave', 'precos_validos_ate')
    .maybeSingle();
  if (error) throw error;
  return (data && data.valor) || null;
}

// ISO -> "18/09/2026 às 17h00" (horário da Bahia).
function fmtVigencia(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  const [data, hora] = f.split(', ');
  return hora ? `${data} às ${hora.replace(':', 'h')}` : data;
}

// Texto simples -> versão texto (com o link no fim, se a mensagem não tiver)
// e versão HTML com cabeçalho, parágrafos e botão pro catálogo.
function montarConteudo({ assunto, mensagem, siteUrl, vigencia }) {
  const jaTemLink = /https?:\/\/\S+/i.test(mensagem);
  const avisoPrecos = vigencia
    ? `Preços válidos até ${vigencia}. Após esse horário a tabela pode ser revisada sem aviso prévio. Ofertas válidas enquanto durar o estoque.`
    : '';
  const corpo = jaTemLink ? mensagem : `${mensagem}\n\nAcesse o catálogo: ${siteUrl}`;
  const texto = avisoPrecos ? `${corpo}\n\n${avisoPrecos}` : corpo;

  const paragrafos = mensagem
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px 0;">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(assunto)}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
  <tr><td style="background:#8f1d1d;color:#ffffff;padding:22px 28px;">
    <div style="font-size:13px;opacity:.85;margin-bottom:4px;">Amvox · Catálogo de Vendas Internas</div>
    <div style="font-size:22px;font-weight:bold;line-height:1.25;">${escapeHtml(assunto)}</div>
  </td></tr>
  <tr><td style="padding:26px 28px 8px 28px;font-size:15px;line-height:1.6;">
    ${paragrafos}
    <p style="margin:8px 0 22px 0;text-align:center;">
      <a href="${escapeHtml(siteUrl)}" style="display:inline-block;background:#8f1d1d;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:6px;font-size:15px;">Ver o catálogo e reservar</a><br>
      <span style="font-size:12px;color:#777;">${escapeHtml(siteUrl)}</span>
    </p>
  </td></tr>
  ${avisoPrecos ? `<tr><td style="padding:0 28px 18px 28px;">
    <div style="border:1px solid #e3d4a8;background:#fdf7e6;border-radius:6px;padding:12px 14px;font-size:12.5px;color:#6b5a20;line-height:1.5;">
      <b>Preços válidos até ${escapeHtml(vigencia)}.</b> Após esse horário a tabela pode ser revisada sem aviso prévio. Ofertas válidas enquanto durar o estoque.
    </div>
  </td></tr>` : ''}
  <tr><td style="padding:14px 28px;background:#f7f7f7;font-size:11px;color:#888;line-height:1.5;">
    Você está recebendo este e-mail porque tem cadastro no Catálogo de Vendas Internas da Amvox.
  </td></tr>
</table>
</body></html>`;

  return { texto, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Transforma URLs do texto (já escapado) em links clicáveis.
function linkify(s) {
  return s.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const limpo = url.replace(/[.,;:!?)]+$/, '');
    const sobra = url.slice(limpo.length);
    return `<a href="${limpo}" style="color:#8f1d1d;">${limpo}</a>${sobra}`;
  });
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
