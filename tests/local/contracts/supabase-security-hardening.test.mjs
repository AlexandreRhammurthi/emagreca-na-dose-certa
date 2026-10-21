import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../../supabase/migrations/20261021010000_harden_public_trigger_functions.sql', import.meta.url), 'utf8');

test('hardening de funções de trigger remove RPC pública sem alterar seus papéis', () => {
  assert.match(migration, /alter function public\.set_updated_at\(\)\s+set search_path = pg_catalog, public;/);
  assert.match(migration, /revoke execute on function public\.handle_new_user\(\)\s+from public, anon, authenticated;/);
  assert.doesNotMatch(migration, /^\s*(?:alter function public\.handle_new_user\(\) security invoker|drop function|drop trigger|alter table|create policy)/im);
});
