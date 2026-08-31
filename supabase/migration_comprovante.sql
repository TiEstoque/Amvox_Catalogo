-- Migração: comprovante do Pix anexado pelo associado
-- (já aplicada no projeto Supabase em 31/08/2026)

-- Caminho do arquivo do comprovante no bucket "comprovantes"
alter table public.chamados add column if not exists comprovante_path text;

-- Bucket privado para os comprovantes (acesso só via API com service role)
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;
