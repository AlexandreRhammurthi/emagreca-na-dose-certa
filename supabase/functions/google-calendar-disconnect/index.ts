import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import postgres from 'npm:postgres@3.4.7';
import { createGoogleCalendarDisconnectHandler } from './core.js';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error('missing_configuration');
  return value;
}

function publishableKey(): string {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyKey) return legacyKey;
  const keyMap = JSON.parse(requiredEnv('SUPABASE_PUBLISHABLE_KEYS')) as Record<string, string>;
  const key = keyMap.default || Object.values(keyMap)[0];
  if (!key) throw new Error('missing_configuration');
  return key;
}

const sql = postgres(requiredEnv('SUPABASE_DB_URL'), {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false
});

async function authenticate(jwt: string): Promise<string> {
  try {
    const client = createClient(requiredEnv('SUPABASE_URL'), publishableKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user?.id) throw new Error('invalid_jwt');
    return data.user.id;
  } catch (error) {
    if (error instanceof Error && error.message === 'missing_configuration') throw error;
    throw new Error('invalid_jwt');
  }
}

async function disconnect(userId: string): Promise<void> {
  await sql.begin(async (transaction) => {
    const required = await transaction<{ table_schema: string; table_name: string; column_name: string }[]>`
      select table_schema, table_name, column_name
      from information_schema.columns
      where (table_schema = 'public' and table_name in ('google_calendar_connections', 'scheduled_applications'))
         or (table_schema = 'private' and table_name = 'google_calendar_credentials')
    `;
    const available = new Set(required.map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`));
    const columns = [
      'public.google_calendar_connections.id', 'public.google_calendar_connections.user_id',
      'public.google_calendar_connections.connection_status', 'public.google_calendar_connections.last_error_code',
      'public.scheduled_applications.user_id', 'public.scheduled_applications.status',
      'public.scheduled_applications.google_sync_status', 'public.scheduled_applications.google_calendar_id',
      'public.scheduled_applications.google_event_id', 'private.google_calendar_credentials.user_id'
    ];
    if (columns.some((column) => !available.has(column))) throw new Error('schema_mismatch');

    await transaction`
      delete from private.google_calendar_credentials
      where user_id = ${userId}::uuid
    `;
    await transaction`
      update public.google_calendar_connections
      set connection_status = 'disconnected', last_error_code = null
      where user_id = ${userId}::uuid
    `;
    await transaction`
      update public.scheduled_applications
      set google_sync_status = 'not_connected', google_calendar_id = null, google_event_id = null
      where user_id = ${userId}::uuid
        and status = 'scheduled'
    `;
  });
}

Deno.serve(createGoogleCalendarDisconnectHandler({ authenticate, disconnect, logger: console }));
