// api/_email.js
// Envio de e-mail via SMTP do Gmail (nodemailer). As credenciais ficam em
// variáveis de ambiente na Vercel:
//   EMAIL_REMETENTE  -> conta Google que envia (ex.: analistati1@amvox.com.br)
//   EMAIL_SENHA_APP  -> senha de app do Google (16 letras), NÃO a senha normal
// Sem essas duas variáveis o envio é pulado silenciosamente (só loga aviso).

import nodemailer from 'nodemailer';

export function emailConfigurado() {
  return !!(process.env.EMAIL_REMETENTE && process.env.EMAIL_SENHA_APP);
}

export async function enviarEmail({ para, assunto, texto, anexos }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_REMETENTE,
      pass: process.env.EMAIL_SENHA_APP,
    },
  });

  await transporter.sendMail({
    from: `"Catálogo Amvox" <${process.env.EMAIL_REMETENTE}>`,
    to: para,
    subject: assunto,
    text: texto,
    attachments: anexos,
  });
}
