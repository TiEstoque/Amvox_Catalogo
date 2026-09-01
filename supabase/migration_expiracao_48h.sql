-- Migração: reservas Pix sem comprovante expiram em 48h
-- (já aplicada no projeto Supabase em 01/09/2026; job pg_cron ativo a cada 30 min)

create extension if not exists pg_cron;

create or replace function public.expirar_reservas_pix()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  it record;
  n integer := 0;
begin
  for c in
    select protocolo from chamados
    where status = 'Aguardando pagamento Pix'
      and data_abertura < now() - interval '48 hours'
  loop
    -- devolve os itens ao catálogo
    for it in
      select item_id, quantidade, is_stock
      from chamado_itens
      where chamado_protocolo = c.protocolo
    loop
      if it.is_stock then
        update item_state
        set reserved_qty = greatest(0, reserved_qty - it.quantidade), updated_at = now()
        where item_id = it.item_id;
      else
        update item_state
        set status = 'Disponível', updated_at = now()
        where item_id = it.item_id;
      end if;
    end loop;

    update chamados
    set status = 'Cancelado',
        observacao_dp = coalesce(observacao_dp || ' · ', '') ||
          'Reserva expirada: 48h sem comprovante de Pix (cancelamento automático).'
    where protocolo = c.protocolo;

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- roda a cada 30 minutos
select cron.schedule('expirar-reservas-pix', '*/30 * * * *', 'select public.expirar_reservas_pix()');
