-- Retenção mínima de telemetria agregada: eventos brutos por 30 dias.
-- Não altera eventos, RLS ou políticas existentes.
create index if not exists product_events_occurred_at_idx
  on public.product_events (occurred_at);

create or replace function public.purge_expired_product_events()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed_count integer;
begin
  delete from public.product_events
  where occurred_at < now() - interval '30 days';
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.purge_expired_product_events() from public;

-- Em projetos com pg_cron habilitado, agenda uma única execução diária às 03:17 UTC.
-- Reversão explícita: select cron.unschedule(jobid) from cron.job where jobname = 'product-events-retention-daily';
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'product-events-retention-daily') then
      perform cron.unschedule(jobid) from cron.job where jobname = 'product-events-retention-daily';
    end if;
    perform cron.schedule('product-events-retention-daily', '17 3 * * *', 'select public.purge_expired_product_events();');
  else
    raise notice 'pg_cron não está habilitado; a Edge Function executará a limpeza defensiva ao carregar o dashboard.';
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name then
    raise notice 'Agendamento pg_cron indisponível; nenhuma extensão foi criada por esta migration.';
end;
$$;
