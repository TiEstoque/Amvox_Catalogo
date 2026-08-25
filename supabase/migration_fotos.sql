-- ============================================================
-- Migração: fotos dos produtos
-- Rode isso no SQL Editor do Supabase (New query > cole tudo > Run)
-- Seguro rodar mesmo já tendo dados — não apaga nada.
-- ============================================================

-- 1) Nova coluna com a URL da foto
alter table items add column if not exists foto_url text;

-- 2) Bucket público de armazenamento para as fotos
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;
