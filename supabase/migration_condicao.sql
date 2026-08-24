-- ============================================================
-- Migração: adiciona o campo "condição" (ex: Sem pé, Arranhado)
-- Rode isso no SQL Editor do Supabase (New query > cole tudo > Run)
-- Seguro rodar mesmo já tendo dados — não apaga nada.
-- ============================================================

-- 1) Nova coluna
alter table items add column if not exists condicao text;

-- 2) Preenche a condição dos itens que tinham defeito/observação na planilha original
update items set condicao = 'Sem pé' where id = 'MON-59';
update items set condicao = 'Sem pé' where id = 'MON-65';
update items set condicao = 'Arranhado e sem pé' where id = 'MON-66';
update items set condicao = 'Sem pé' where id = 'MON-68';
update items set condicao = 'Sem pé' where id = 'MON-69';
update items set condicao = 'Sem pé' where id = 'MON-70';
update items set condicao = 'Sem pé e tela arranhada' where id = 'MON-76';
update items set condicao = 'Sem pé' where id = 'MON-93';
update items set condicao = 'Sem pé' where id = 'MON-94';
update items set condicao = 'Sem pé' where id = 'MON-95';
update items set condicao = 'Sem pé' where id = 'MON-98';
update items set condicao = 'Sem pé' where id = 'MON-103';
update items set condicao = 'Novo' where id = 'MON-104';

-- 3) Limpa a menção redundante da descrição (a condição agora vive no campo próprio)
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: (SEM PE ) ', '')) where id = 'MON-59';
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: SEM PE  ', '')) where id = 'MON-65';
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: Arranhado e sem Pe ', '')) where id = 'MON-66';
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: sem pe ', '')) where id in ('MON-68','MON-69','MON-70');
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: sem pe e tela arranhada ', '')) where id = 'MON-76';
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: SEM PE ', '')) where id in ('MON-93','MON-94','MON-95','MON-98','MON-103');
update items set descricao = trim(both ' ·' from replace(descricao, '· Obs: NOVO ', '')) where id = 'MON-104';
