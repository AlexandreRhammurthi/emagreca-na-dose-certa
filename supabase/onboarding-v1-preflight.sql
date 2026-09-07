-- Onboarding V1 / Sprint 2 — auditoria de pré-execução.
-- Execute no SQL Editor do Supabase antes da migration. Este arquivo contém
-- apenas SELECTs sobre o catálogo: não cria, altera ou remove dados, tabelas,
-- policies ou funções. O SQL Editor executa cada comando isoladamente; por
-- isso não abrimos uma transação explícita neste roteiro.

-- 1. Confirmar que a migration ainda não foi aplicada e que as relações de
--    negócio existentes que precisam sumir com a conta estão catalogadas.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('onboarding_profiles', 'user_consents', 'applications',
    'weight_records', 'application_plans', 'scheduled_applications',
    'google_calendar_connections')
order by table_name;

-- 2. Toda tabela que referencia auth.users deve ser revisada. A deleção
--    permanente só é segura quando a cadeia necessária usa ON DELETE CASCADE
--    ou quando houver uma rotina transacional explicitamente aprovada.
select
  ns.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where con.contype = 'f'
  and pg_get_constraintdef(con.oid) ilike '%auth.users%'
order by schema_name, table_name, constraint_name;

-- 3. Confirmar a cadeia de dependências de plano, aplicações, pesos e Google.
select
  ns.nspname as schema_name,
  rel.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where con.contype = 'f'
  and ns.nspname in ('public', 'private')
  and rel.relname in ('applications', 'weight_records', 'application_plans',
    'scheduled_applications', 'google_calendar_connections',
    'google_calendar_credentials', 'google_oauth_states')
order by schema_name, table_name, constraint_name;

-- 4. Depois de aplicar a migration, esta consulta deve retornar oito policies
--    próprias (quatro por tabela), todas limitadas a auth.uid().
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('onboarding_profiles', 'user_consents')
order by tablename, cmd, policyname;
