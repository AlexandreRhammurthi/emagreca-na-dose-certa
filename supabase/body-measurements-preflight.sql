-- Medidas Corporais V1: consultas somente leitura antes da migration.

select to_regclass('public.body_measurements') as body_measurements;

select p.oid::regprocedure as function_signature
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_updated_at';

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'weight_records';
