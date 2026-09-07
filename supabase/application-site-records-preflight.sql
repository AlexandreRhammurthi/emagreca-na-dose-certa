-- Lembretes e rodízio V1: roteiro somente leitura. Não cria ou altera dados.

-- 1. Confirmar as chaves compostas exigidas pelas FKs da proposta.
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.applications'::regclass, 'public.scheduled_applications'::regclass)
  and contype in ('p', 'u', 'f')
order by table_name, constraint_type, constraint_name;

-- 2. Confirmar tipos e nulabilidade dos identificadores de ownership.
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('applications', 'scheduled_applications')
  and column_name in ('id', 'user_id')
order by table_name, column_name;

-- 3. Confirmar RLS e policies existentes nas tabelas de origem.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('applications', 'scheduled_applications');

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('applications', 'scheduled_applications')
order by tablename, policyname;

-- 4. Confirmar que a nova tabela ainda não existe e que não há policies residuais.
select to_regclass('public.application_site_records') as proposed_table;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'application_site_records';
