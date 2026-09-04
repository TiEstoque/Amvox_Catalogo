// api/_email.js
// Envio de e-mail via SMTP (nodemailer). As credenciais ficam em variáveis
// de ambiente na Vercel:
//   EMAIL_REMETENTE  -> conta que envia (ex.: gerentetiamvox@gmail.com)
//   EMAIL_SENHA_APP  -> senha de app do Google (16 letras), NÃO a senha normal
//   EMAIL_SMTP_HOST  -> opcional; padrão smtp.gmail.com
//   EMAIL_SMTP_PORT  -> opcional; padrão 465 (SSL). Use 587 pra STARTTLS.
// Obs.: o e-mail @amvox.com.br é Microsoft 365, que não aceita mais envio
// SMTP com senha simples — por isso o remetente padrão é uma conta Gmail.
// Sem EMAIL_REMETENTE/EMAIL_SENHA_APP o envio é pulado (só loga aviso).

import nodemailer from 'nodemailer';
import { getSupabase } from './_supabase.js';

export function emailConfigurado() {
  return !!(process.env.EMAIL_REMETENTE && process.env.EMAIL_SENHA_APP);
}

// Registra cada tentativa (sucesso ou erro) em email_logs — falha no log
// nunca afeta o envio.
async function registrarLog(para, assunto, ok, erro) {
  try {
    const supabase = getSupabase();
    await supabase.from('email_logs').insert({ para, assunto, ok, erro: erro || null });
  } catch (logErr) {
    console.error('Falha ao registrar log de e-mail:', logErr.message);
  }
}

export async function enviarEmail({ para, assunto, texto, anexos }) {
  const porta = Number(process.env.EMAIL_SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: porta,
    secure: porta === 465,
    auth: {
      user: process.env.EMAIL_REMETENTE,
      pass: process.env.EMAIL_SENHA_APP,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Catálogo Amvox" <${process.env.EMAIL_REMETENTE}>`,
      to: para,
      subject: assunto,
      text: texto,
      attachments: anexos,
    });
    await registrarLog(para, assunto, true, null);
  } catch (e) {
    await registrarLog(para, assunto, false, String((e && e.message) || e));
    throw e;
  }
}
