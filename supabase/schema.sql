-- ============================================================
-- Catálogo Amvox — schema Supabase (Postgres)
-- Rode este script inteiro no SQL Editor do Supabase
-- (Project > SQL Editor > New query > cole tudo > Run)
-- ============================================================

-- 1) Itens do catálogo (tanto os 128 originais da planilha quanto os
--    que forem adicionados depois pelo Painel Administrativo)
create table if not exists items (
  id text primary key,
  categoria text not null,
  numero text not null,
  titulo text not null,
  descricao text not null default '',
  preco numeric(10,2) not null,
  estoque integer,                 -- null = item único (patrimônio); número = item com quantidade (ex: SSD)
  is_custom boolean not null default false,
  ativo boolean not null default true,   -- "removido" no painel = ativo=false (soft delete, nada se perde)
  created_at timestamptz not null default now()
);

-- 2) Estado de reserva/venda de cada item
create table if not exists item_state (
  item_id text primary key references items(id) on delete cascade,
  status text not null default 'Disponível',   -- Disponível | Reservado | Vendido (itens únicos)
  reserved_qty integer not null default 0,      -- itens com estoque (SSDs etc.)
  sold_qty integer not null default 0,          -- itens com estoque
  updated_at timestamptz not null default now()
);

-- 3) Sequência para gerar os protocolos (AMX-00001, AMX-00002, ...)
create sequence if not exists chamado_seq start 1;

-- 4) Chamados / reservas abertas pelos associados
create table if not exists chamados (
  protocolo text primary key default ('AMX-' || lpad(nextval('chamado_seq')::text, 5, '0')),
  nome text not null,
  matricula text not null,
  valor_total numeric(10,2) not null,
  pagamento text not null,                -- Pix | Crédito em Folha
  parcelas integer,
  valor_parcela numeric(10,2),
  status text not null,                   -- Aguardando pagamento Pix | Aguardando avaliação do DP |
                                           -- Aprovado pelo DP | Reprovado pelo DP | Concluído | Cancelado
  observacao_dp text,
  data_abertura timestamptz not null default now()
);

-- 5) Itens de cada chamado (um chamado pode ter vários itens selecionados)
create table if not exists chamado_itens (
  id bigint generated always as identity primary key,
  chamado_protocolo text not null references chamados(protocolo) on delete cascade,
  item_id text not null references items(id),
  numero text not null,
  titulo text not null,
  categoria text not null,
  preco numeric(10,2) not null,
  quantidade integer not null,
  is_stock boolean not null default false
);

create index if not exists idx_chamado_itens_protocolo on chamado_itens(chamado_protocolo);
create index if not exists idx_chamados_nome on chamados using gin (to_tsvector('simple', nome));
create index if not exists idx_chamados_matricula on chamados(matricula);
create index if not exists idx_items_ativo on items(ativo);

-- 6) Segurança: bloqueia acesso direto via chave pública (anon/browser).
--    Todo acesso passa pelas funções serverless da Vercel, que usam a
--    service_role key (só existe no servidor, nunca no navegador).
alter table items enable row level security;
alter table item_state enable row level security;
alter table chamados enable row level security;
alter table chamado_itens enable row level security;
-- (Sem "create policy" nenhuma = nada acessível via chave anônima. De propósito.)


-- 7) Seed com os 128 itens originais da planilha
-- (Esses IDs batem com os usados na planilha original: PC-xxx, MON-xxx, IMP-xxx, SSD-xxx)
insert into items (id, categoria, numero, titulo, descricao, preco, estoque, is_custom) values
('PC-431', 'Computadores', '431', 'Computador #431', 'Intel i3-3220T · 480 GB · 12 GB RAM', 350, null, false),
('PC-49', 'Computadores', '49', 'Computador #49', 'Intel i3-6100 · 240 GB · 12 GB RAM', 350, null, false),
('PC-66', 'Computadores', '66', 'Computador #66', 'Intel i3-7100 · SSD 240 GB · 4 GB RAM', 350, null, false),
('PC-288', 'Computadores', '288', 'Computador #288', 'Intel i3-3220 · 256 GB · 8 GB RAM', 300, null, false),
('PC-283', 'Computadores', '283', 'Computador #283', 'Intel i3-3220 · 256 GB · 16 GB RAM', 400, null, false),
('PC-305', 'Computadores', '305', 'Computador #305', 'Intel i3-3220 · 240 GB · 12 GB RAM', 350, null, false),
('PC-282', 'Computadores', '282', 'Computador #282', 'Intel i3-3220 3.30GHz · 256 GB · 8 GB DDR3 RAM', 350, null, false),
('PC-354', 'Computadores', '354', 'Computador #354', 'Intel i3-3470 · 256 GB · 12 GB RAM', 350, null, false),
('PC-41', 'Computadores', '41', 'Computador #41', 'Intel i3-6100T 3.20GHz · 256 GB · 12 GB RAM', 350, null, false),
('PC-100', 'Computadores', '100', 'Computador #100', 'Intel i3-7100 · SSD 240 GB · 8 GB RAM', 300, null, false),
('PC-294', 'Computadores', '294', 'Computador #294', 'Intel i3-3240 · 240 GB · 16 GB RAM', 400, null, false),
('PC-281', 'Computadores', '281', 'Computador #281', 'Intel i5-3470 · 240 GB · 8 GB RAM', 300, null, false),
('PC-125', 'Computadores', '125', 'Computador #125', 'Intel i3-7100 · 240 GB · 4 GB RAM', 300, null, false),
('PC-19', 'Computadores', '19', 'Computador #19', 'Intel i3-7100 · 240 GB · 16 GB RAM', 350, null, false),
('PC-703', 'Computadores', '703', 'Computador #703', 'Intel i7-9700 3.00GHz · 240 GB · 32 GB RAM · Sem placa de vídeo', 1200, null, false),
('PC-734', 'Computadores', '734', 'Computador #734', 'AMD Ryzen 5 5600GT · 240 GB · 16 GB RAM · Sem placa de vídeo', 800, null, false),
('MON-1', 'Monitores', '1', 'Monitor #1', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-2', 'Monitores', '2', 'Monitor #2', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-3', 'Monitores', '3', 'Monitor #3', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-4', 'Monitores', '4', 'Monitor #4', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-5', 'Monitores', '5', 'Monitor #5', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-6', 'Monitores', '6', 'Monitor #6', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-7', 'Monitores', '7', 'Monitor #7', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-8', 'Monitores', '8', 'Monitor #8', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-9', 'Monitores', '9', 'Monitor #9', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-10', 'Monitores', '10', 'Monitor #10', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-11', 'Monitores', '11', 'Monitor #11', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-12', 'Monitores', '12', 'Monitor #12', 'MONITOR AOC 18,5" – E950SWDAN · Entradas: VGA e DVI', 100, null, false),
('MON-13', 'Monitores', '13', 'Monitor #13', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-14', 'Monitores', '14', 'Monitor #14', 'Lenovo 19,5" ThinkVision E2002ba · Entradas: VGA e DVI', 150, null, false),
('MON-15', 'Monitores', '15', 'Monitor #15', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-16', 'Monitores', '16', 'Monitor #16', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-17', 'Monitores', '17', 'Monitor #17', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-18', 'Monitores', '18', 'Monitor #18', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-19', 'Monitores', '19', 'Monitor #19', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-20', 'Monitores', '20', 'Monitor #20', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-21', 'Monitores', '21', 'Monitor #21', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-22', 'Monitores', '22', 'Monitor #22', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-23', 'Monitores', '23', 'Monitor #23', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-24', 'Monitores', '24', 'Monitor #24', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-25', 'Monitores', '25', 'Monitor #25', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-26', 'Monitores', '26', 'Monitor #26', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-27', 'Monitores', '27', 'Monitor #27', 'MONITOR DELL 18,5" – E1912HC · Entradas: VGA', 100, null, false),
('MON-28', 'Monitores', '28', 'Monitor #28', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA', 100, null, false),
('MON-29', 'Monitores', '29', 'Monitor #29', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-30', 'Monitores', '30', 'Monitor #30', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-31', 'Monitores', '31', 'Monitor #31', 'Lenovo 19,5" ThinkVision E2002ba · Entradas: VGA e DVI', 150, null, false),
('MON-32', 'Monitores', '32', 'Monitor #32', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-33', 'Monitores', '33', 'Monitor #33', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-34', 'Monitores', '1001', 'Monitor #1001', 'MONITOR SAMSUNG 24" · Entradas: HDMI e DisplayPort', 300, null, false),
('MON-35', 'Monitores', '829', 'Monitor #829', 'MONITOR SAMSUNG 24" · Entradas: HDMI e DisplayPort', 300, null, false),
('MON-36', 'Monitores', '708', 'Monitor #708', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-37', 'Monitores', '692', 'Monitor #692', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-38', 'Monitores', '418', 'Monitor #418', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-39', 'Monitores', '572', 'Monitor #572', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-40', 'Monitores', '474', 'Monitor #474', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-41', 'Monitores', '261', 'Monitor #261', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-42', 'Monitores', '554', 'Monitor #554', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-43', 'Monitores', '101', 'Monitor #101', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-44', 'Monitores', '691', 'Monitor #691', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-45', 'Monitores', '613', 'Monitor #613', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-46', 'Monitores', '417', 'Monitor #417', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-47', 'Monitores', '707', 'Monitor #707', 'MONITOR AOC 21 - 22B30HM2 · Entradas: VGA e HDMI', 200, null, false),
('MON-48', 'Monitores', '459', 'Monitor #459', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-49', 'Monitores', '635', 'Monitor #635', 'PCTOP 17 MODELO MLP1 · Entradas: VGA e HDMI', 100, null, false),
('MON-50', 'Monitores', '406', 'Monitor #406', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-52', 'Monitores', '144', 'Monitor #144', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-53', 'Monitores', '678', 'Monitor #678', 'MONITOR AOC 21.5 - 2270SWHEN · Entradas: VGA e HDMI', 150, null, false),
('MON-54', 'Monitores', '827', 'Monitor #827', 'MONITOR AOC 21 - 22B30HM2 · Entradas: VGA e HDMI', 150, null, false),
('MON-55', 'Monitores', '465', 'Monitor #465', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-56', 'Monitores', '183', 'Monitor #183', 'MONITOR PHILLIPS 24 - · Entradas: VGA e HDMI', 300, null, false),
('MON-57', 'Monitores', '564', 'Monitor #564', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-58', 'Monitores', '46', 'Monitor #46', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-59', 'Monitores', '421', 'Monitor #421', 'MONITOR AOC 18,5" – E970SWHNL · Obs: (SEM PE ) · Entradas: VGA e HDMI', 100, null, false),
('MON-60', 'Monitores', '873', 'Monitor #873', 'MONITOR AOC 21 - 22B30HM2 · Entradas: VGA e HDMI', 150, null, false),
('MON-61', 'Monitores', '403', 'Monitor #403', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-62', 'Monitores', '146', 'Monitor #146', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-63', 'Monitores', '839', 'Monitor #839', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-64', 'Monitores', '136', 'Monitor #136', 'MONITOR LOGIN 19.5 · Entradas: VGA', 100, null, false),
('MON-65', 'Monitores', '912', 'Monitor #912', 'MONITOR AOC 21 - 22B30HM2 ( SEM PE E FONTE) · Obs: SEM PE  · Entradas: VGA e HDMI', 150, null, false),
('MON-66', 'Monitores', '743', 'Monitor #743', 'MONITOR AOC 24 M2470SWH2 · Obs: Arranhado e sem Pe · Entradas: VGA e HDMI', 100, null, false),
('MON-67', 'Monitores', '345', 'Monitor #345', 'Lenovo 19,5" ThinkVision E2002ba · Entradas: DVI e VGA', 90, null, false),
('MON-68', 'Monitores', '705', 'Monitor #705', 'MONITOR AOC 18,5" – E970SWHNL · Obs: sem pe · Entradas: VGA e HDMI', 100, null, false),
('MON-69', 'Monitores', '1002', 'Monitor #1002', 'MONITOR AOC 21.5 - 2270SWHEN · Obs: sem pe · Entradas: VGA e HDMI', 150, null, false),
('MON-70', 'Monitores', '700', 'Monitor #700', 'MONITOR AOC 18,5" – E970SWHNL · Obs: sem pe · Entradas: VGA e HDMI', 100, null, false),
('MON-71', 'Monitores', '37', 'Monitor #37', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-72', 'Monitores', '74', 'Monitor #74', 'MONITOR AOC F19L · Entradas: HDMI E DVI', 90, null, false),
('MON-73', 'Monitores', '832', 'Monitor #832', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-74', 'Monitores', '152', 'Monitor #152', 'MONITOR AOC 24 M2470SWH2 · Entradas: VGA E DVI', 100, null, false),
('MON-76', 'Monitores', '529', 'Monitor #529', 'MONITOR AOC 21.5 - 2270SWHEN · Obs: sem pe e tela arranhada · Entradas: VGA e HDMI', 60, null, false),
('MON-77', 'Monitores', '641', 'Monitor #641', 'MONITOR AOC 21.5 - 2270SWHEN · Entradas: VGA e HDMI', 150, null, false),
('MON-78', 'Monitores', '632', 'Monitor #632', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-79', 'Monitores', '54', 'Monitor #54', 'MONITOR SAMSUNG 20 S20D300NH · Entradas: VGA', 70, null, false),
('MON-80', 'Monitores', '110', 'Monitor #110', 'MONITOR LG 20 EM33SSA · Entradas: VGA', 90, null, false),
('MON-81', 'Monitores', '1015', 'Monitor #1015', 'PCTOP 17 MODELO MLP1 · Entradas: VGA', 80, null, false),
('MON-82', 'Monitores', '337', 'Monitor #337', 'PCTOP 17 MODELO MLP1 · Entradas: VGA', 80, null, false),
('MON-83', 'Monitores', '156', 'Monitor #156', 'PCTOP 17 MODELO MLP1 · Entradas: VGA', 80, null, false),
('MON-84', 'Monitores', '335', 'Monitor #335', 'PCTOP 17 MODELO MLP1 · Entradas: VGA', 80, null, false),
('MON-85', 'Monitores', '334', 'Monitor #334', 'PCTOP 17 MODELO MLP1 · Entradas: VGA', 80, null, false),
('MON-86', 'Monitores', '412', 'Monitor #412', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-87', 'Monitores', '689', 'Monitor #689', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-88', 'Monitores', '579', 'Monitor #579', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-89', 'Monitores', '914', 'Monitor #914', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-90', 'Monitores', '99', 'Monitor #99', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-91', 'Monitores', '70', 'Monitor #70', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-92', 'Monitores', '297', 'Monitor #297', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-93', 'Monitores', '323', 'Monitor #323', 'Lenovo 19,5" ThinkVision E2002ba · Obs: SEM PE · Entradas: DVI e VGA', 90, null, false),
('MON-94', 'Monitores', '441', 'Monitor #441', 'MONITOR AOC 21.5 - 2270SWHEN · Obs: SEM PE · Entradas: VGA e HDMI', 150, null, false),
('MON-95', 'Monitores', '690', 'Monitor #690', 'MONITOR AOC 24 M2470SWH2 · Obs: SEM PE · Entradas: VGA e HDMI', 60, null, false),
('MON-96', 'Monitores', '60', 'Monitor #60', 'MONITOR AOC 18,5 E950SW · Entradas: VGA', 100, null, false),
('MON-97', 'Monitores', '97', 'Monitor #97', 'MONITOR AOC 19F19L · Entradas: VGA', 10, null, false),
('MON-98', 'Monitores', '438', 'Monitor #438', 'MONITOR AOC 21.5 - 2270SWHEN · Obs: SEM PE · Entradas: VGA e HDMI', 150, null, false),
('MON-99', 'Monitores', '448', 'Monitor #448', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-100', 'Monitores', '5', 'Monitor #5', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-101', 'Monitores', '599', 'Monitor #599', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-102', 'Monitores', '460', 'Monitor #460', 'MONITOR AOC 18,5" – E970SWHNL · Entradas: VGA e HDMI', 100, null, false),
('MON-103', 'Monitores', '404', 'Monitor #404', 'MONITOR AOC 21.5 - 2270SWHEN · Obs: SEM PE · Entradas: VGA e HDMI', 150, null, false),
('MON-104', 'Monitores', '101306', 'Monitor #101306', 'MONITOR AOC 18,5" – E970SWHNL · Obs: NOVO · Entradas: VGA e HDMI', 100, null, false),
('IMP-1', 'Impressoras', '1', 'Impressora #1', 'HL-1210W – Impressora laser monocromática', 300, null, false),
('IMP-2', 'Impressoras', '2', 'Impressora #2', 'HL-1210W – Impressora laser monocromática', 300, null, false),
('IMP-3', 'Impressoras', '3', 'Impressora #3', 'HL-1210W – Impressora laser monocromática', 300, null, false),
('IMP-4', 'Impressoras', '4', 'Impressora #4', 'Brother HL-T4000DW – jato de tinta, colorida, Wi-Fi, wireless, USB, 110V', 800, null, false),
('SSD-1', 'SSDs e Periféricos', '1', 'SSD 240 GB (Kingston)', 'Kingston · 240 GB · 9 unid. disponíveis', 100, 9, false),
('SSD-2', 'SSDs e Periféricos', '2', 'SSD 480 GB (Kingston)', 'Kingston · 480 GB · 2 unid. disponíveis', 200, 2, false),
('SSD-3', 'SSDs e Periféricos', '3', 'SSD 480 GB (WD Green)', 'WD Green · 480 GB · 1 unid. disponíveis', 180, 1, false),
('SSD-4', 'SSDs e Periféricos', '4', 'SSD 240 GB (Várias marcas)', 'Várias marcas · 240 GB · 13 unid. disponíveis', 100, 13, false),
('SSD-5', 'SSDs e Periféricos', '5', 'SSD 256 GB (Várias marcas)', 'Várias marcas · 256 GB · 3 unid. disponíveis', 130, 3, false),
('SSD-6', 'SSDs e Periféricos', '6', 'Teclado - (Logitech, com fio)', 'Logitech, com fio · - · 2 unid. disponíveis', 60, 2, false)
on conflict (id) do nothing;

-- 8) Estado inicial "Disponível" para os itens únicos (sem estoque numérico)
insert into item_state (item_id, status)
select id, 'Disponível' from items where estoque is null
on conflict (item_id) do nothing;

insert into item_state (item_id, reserved_qty, sold_qty)
select id, 0, 0 from items where estoque is not null
on conflict (item_id) do nothing;
