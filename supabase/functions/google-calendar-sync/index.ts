import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import postgres from 'npm:postgres@3.4.7';
import {
  createCalendarSyncHandler,
  requestGoogleAccessToken,
  upsertGoogleCalendarEvent
} from './core.js';

const REQUIRED_COLUMNS = Object.freeze({
  'public.scheduled_applications': [
    'id', 'user_id', 'plan_id', 'scheduled_date', 'scheduled_time', 'timezone',
    'status', 'reminder_minutes', 'google_calendar_id', 'google_event_id', 'google_sync_status'
  ],
  'public.application_plans': ['id', 'user_id', 'medicine', 'dose_mg'],
  'public.google_calendar_connections': [
    'id', 'user_id', 'calendar_id', 'connection_status', 'last_sync_at', 'last_error_code'
  ],
  'private.google_calendar_credentials': [
    'connection_id', 'user_id', 'refresh_token_ciphertext', 'refresh_token_nonce',
    'encryption_key_version'
  ]
});

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

async function validateSchema(): Promise<void> {
  const rows = await sql<{ table_schema: string; table_name: string; column_name: string }[]>`
    select table_schema, table_name, column_name
    from information_schema.columns
    where (table_schema = 'public' and table_name in (
      'scheduled_applications', 'application_plans', 'google_calendar_connections'
    )) or (table_schema = 'private' and table_name = 'google_calendar_credentials')
  `;
  const available = new Set(rows.map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`));
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    if (columns.some((column) => !available.has(`${table}.${column}`))) {
      const error = new Error('schema_mismatch');
      (error as Error & { category: string }).category = 'schema_mismatch';
      throw error;
    }
  }
}

type OccurrenceRow = {
  id: string;
  status: string;
  scheduled_date: string;
  scheduled_time: string;
  timezone: string;
  reminder_minutes: number[];
  medicine: string;
  dose_mg: string;
};

async function loadOccurrence(userId: string, occurrenceId: string) {
  const rows = await sql<OccurrenceRow[]>`
    select
      sa.id,
      sa.status,
      sa.scheduled_date::text,
      sa.scheduled_time::text,
      sa.timezone,
      sa.reminder_minutes,
      ap.medicine,
      ap.dose_mg::text
    from public.scheduled_applications sa
    inner join public.application_plans ap
      on ap.id = sa.plan_id
     and ap.user_id = sa.user_id
    where sa.id = ${occurrenceId}::uuid
      and sa.user_id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row ? {
    id: row.id,
    status: row.status,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    timezone: row.timezone,
    reminderMinutes: row.reminder_minutes,
    medicine: row.medicine,
    doseMg: row.dose_mg
  } : null;
}

async function loadConnection(userId: string) {
  const rows = await sql<{ id: string; calendar_id: string; connection_status: string }[]>`
    select id, calendar_id, connection_status
    from public.google_calendar_connections
    where user_id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row ? {
    id: row.id,
    calendarId: row.calendar_id?.trim() === 'primary' ? 'primary' : null,
    connectionStatus: row.connection_status
  } : null;
}

async function loadCredential(connectionId: string, userId: string) {
  const rows = await sql<{
    refresh_token_ciphertext: Uint8Array;
    refresh_token_nonce: Uint8Array;
    encryption_key_version: number;
  }[]>`
    select refresh_token_ciphertext, refresh_token_nonce, encryption_key_version
    from private.google_calendar_credentials
    where connection_id = ${connectionId}::uuid
      and user_id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  return row ? {
    ciphertext: row.refresh_token_ciphertext,
    nonce: row.refresh_token_nonce,
    encryptionKeyVersion: row.encryption_key_version
  } : null;
}

type SyncUpdate = {
  userId: string;
  occurrenceId: string;
  syncStatus: 'not_connected' | 'pending' | 'error';
};

async function setOccurrenceSync(update: SyncUpdate): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update public.scheduled_applications
    set google_sync_status = ${update.syncStatus}
    where id = ${update.occurrenceId}::uuid
      and user_id = ${update.userId}::uuid
      and status = 'scheduled'
    returning id
  `;
  return Boolean(rows[0]);
}

type FinalizeSyncInput = {
  userId: string;
  occurrenceId: string;
  calendarId: string;
  eventId: string;
  operation: 'created' | 'updated';
};

async function finalizeOccurrenceSync(input: FinalizeSyncInput) {
  const rows = await sql<{ status: string; google_sync_status: string }[]>`
    update public.scheduled_applications
    set
      google_calendar_id = ${input.calendarId},
      google_event_id = ${input.eventId},
      google_sync_status = case when status = 'scheduled' then 'synced' else 'error' end
    where id = ${input.occurrenceId}::uuid
      and user_id = ${input.userId}::uuid
    returning status, google_sync_status
  `;
  const row = rows[0];
  if (!row) return null;
  return row.status === 'scheduled' && row.google_sync_status === 'synced'
    ? { result: 'synced' as const }
    : { result: 'occurrence_changed' as const };
}

async function expireConnection(input: {
  connectionId: string;
  userId: string;
  errorCode: 'invalid_grant';
}): Promise<void> {
  await sql`
    update public.google_calendar_connections
    set connection_status = 'expired', last_error_code = ${input.errorCode}
    where id = ${input.connectionId}::uuid
      and user_id = ${input.userId}::uuid
  `;
}

async function markConnectionSynced(input: { connectionId: string; userId: string }): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    update public.google_calendar_connections
    set last_sync_at = now(), last_error_code = null
    where id = ${input.connectionId}::uuid
      and user_id = ${input.userId}::uuid
      and connection_status = 'connected'
    returning id
  `;
  if (!rows[0]) throw new Error('connection_sync_metadata_failed');
}

const handler = createCalendarSyncHandler({
  authenticate,
  validateSchema,
  loadOccurrence,
  loadConnection,
  loadCredential,
  setOccurrenceSync,
  finalizeOccurrenceSync,
  expireConnection,
  markConnectionSynced,
  refreshAccessToken: requestGoogleAccessToken,
  upsertGoogleEvent: upsertGoogleCalendarEvent,
  getEnv: (name: string) => Deno.env.get(name),
  logger: console
});

Deno.serve(handler);
