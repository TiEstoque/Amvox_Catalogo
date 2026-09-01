-- Migração: bloqueio de usuários cadastrados pelo Painel Administrativo
-- (já aplicada no projeto Supabase em 01/09/2026)

alter table public.cadastros_acesso add column if not exists bloqueado boolean not null default false;
