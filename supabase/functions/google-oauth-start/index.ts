import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import postgres, { type TransactionSql } from 'npm:postgres@3.4.7';
import { createOAuthStartHandler } from './core.js';

const REQUIRED_STATE_COLUMNS = Object.freeze([
  'user_id',
  'state_hash',
  'pkce_verifier_ciphertext',
  'pkce_verifier_nonce',
  'encryption_key_version',
  'redirect_target',
  'expires_at',
  'used_at'
]);

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function publishableKey(): string {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyKey) return legacyKey;

  const keyMap = JSON.parse(requiredEnv('SUPABASE_PUBLISHABLE_KEYS')) as Record<string, string>;
  const key = keyMap.default || Object.values(keyMap)[0];
  if (!key) throw new Error('missing_supabase_publishable_key');
  return key;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const databaseUrl = requiredEnv('SUPABASE_DB_URL');
const sql = postgres(databaseUrl, {
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
    if (error instanceof Error && error.message.startsWith('missing_')) throw error;
    throw new Error('invalid_jwt');
  }
}

async function getConnectionStatus(userId: string): Promise<string | null> {
  const rows = await sql<{ connection_status: string }[]>`
    select connection_status
    from public.google_calendar_connections
    where user_id = ${userId}::uuid
    limit 1
  `;
  return rows[0]?.connection_status ?? null;
}

async function validateStateSchema(transaction: TransactionSql): Promise<void> {
  const rows = await transaction<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'google_oauth_states'
  `;
  const available = new Set(rows.map(({ column_name }) => column_name));
  if (REQUIRED_STATE_COLUMNS.some((column) => !available.has(column))) {
    throw new Error('oauth_state_schema_mismatch');
  }
}

type OAuthStateRecord = {
  userId: string;
  stateHash: Uint8Array;
  verifierCiphertext: Uint8Array;
  verifierNonce: Uint8Array;
  encryptionKeyVersion: number;
  redirectTarget: string;
  expiresAt: Date;
  usedAt: null;
};

async function persistOAuthState(record: OAuthStateRecord): Promise<void> {
  await sql.begin(async (transaction) => {
    await validateStateSchema(transaction);

    await transaction`
      delete from private.google_oauth_states
      where user_id = ${record.userId}::uuid
        and expires_at <= now()
    `;

    await transaction`
      insert into private.google_oauth_states (
        user_id,
        state_hash,
        pkce_verifier_ciphertext,
        pkce_verifier_nonce,
        encryption_key_version,
        redirect_target,
        expires_at,
        used_at
      ) values (
        ${record.userId}::uuid,
        decode(${bytesToHex(record.stateHash)}, 'hex'),
        decode(${bytesToHex(record.verifierCiphertext)}, 'hex'),
        decode(${bytesToHex(record.verifierNonce)}, 'hex'),
        ${record.encryptionKeyVersion},
        ${record.redirectTarget},
        ${record.expiresAt.toISOString()}::timestamptz,
        ${record.usedAt}
      )
    `;
  });
}

const handler = createOAuthStartHandler({
  authenticate,
  getConnectionStatus,
  persistOAuthState,
  getEnv: (name: string) => Deno.env.get(name),
  logger: console
});

Deno.serve(handler);
