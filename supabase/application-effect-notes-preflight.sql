-- Relatório PDF V1: somente leitura antes da migration de anotações livres.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid = 'public.applications'::regclass and contype in ('p','u');
select to_regclass('public.application_effect_notes') as application_effect_notes;
select p.oid::regprocedure as function_signature
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='set_updated_at';
