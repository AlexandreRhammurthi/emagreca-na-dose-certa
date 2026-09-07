-- Duração do frasco V1: consultas somente leitura antes da migration.

select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.applications'::regclass and contype in ('p', 'u', 'f')
order by contype, conname;

select p.oid::regprocedure as function_signature
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'set_updated_at';

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'applications';

select to_regclass('public.medication_vials') as medication_vials,
       to_regclass('public.vial_usages') as vial_usages;
