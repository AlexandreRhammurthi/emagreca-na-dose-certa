import postgres, { type TransactionSql } from 'npm:postgres@3.4.7';
import { createOAuthCallbackHandler, decideRefreshCredential } from './core.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const REQUIRED_COLUMNS = Object.freeze({
  'private.google_oauth_states': [
    'user_id', 'state_hash', 'pkce_verifier_ciphertext', 'pkce_verifier_nonce',
    'encryption_key_version', 'redirect_target', 'expires_at', 'used_at'
  ],
  'public.google_calendar_connections': [
    'id', 'user_id', 'google_subject_hash', 'google_account_hint', 'calendar_id',
    'granted_scopes', 'connection_status', 'last_error_code'
  ],
  'private.google_calendar_credentials': [
    'connection_id', 'user_id', 'refresh_token_ciphertext', 'refresh_token_nonce',
    'encryption_key_version', 'token_type'
  ]
});

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error('missing_configuration');
  return value;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

class ExternalRequestError extends Error {
  httpStatus: number;

  constructor(category: string, httpStatus: number) {
    super(category);
    this.httpStatus = httpStatus;
  }
}

const sql = postgres(requiredEnv('SUPABASE_DB_URL'), {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false
});

async function validateSchema(): Promise<void> {
  const rows = await sql<{ table_schema: string; table_name: string; column_name: string }[]>`
    select table_schema, table_name, column_name
    from information_schema.columns
    where (table_schema = 'private' and table_name in ('google_oauth_states', 'google_calendar_credentials'))
       or (table_schema = 'public' and table_name = 'google_calendar_connections')
  `;
  const columns = new Set(rows.map((row) => `${row.table_schema}.${row.table_name}.${row.column_name}`));
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    if (required.some((column) => !columns.has(`${table}.${column}`))) {
      throw new Error('callback_schema_mismatch');
    }
  }
}

type StateRecord = {
  userId: string;
  verifierCiphertext: Uint8Array;
  verifierNonce: Uint8Array;
  encryptionKeyVersion: number;
};

async function consumeOAuthState(
  stateHash: Uint8Array,
  redirectTarget: 'plan'
): Promise<StateRecord | null> {
  const rows = await sql<{
    user_id: string;
    pkce_verifier_ciphertext: Uint8Array;
    pkce_verifier_nonce: Uint8Array;
    encryption_key_version: number;
  }[]>`
    update private.google_oauth_states
    set used_at = now()
    where state_hash = decode(${bytesToHex(stateHash)}, 'hex')
      and used_at is null
      and expires_at > now()
      and redirect_target = ${redirectTarget}
    returning
      user_id,
      pkce_verifier_ciphertext,
      pkce_verifier_nonce,
      encryption_key_version
  `;
  const record = rows[0];
  return record ? {
    userId: record.user_id,
    verifierCiphertext: record.pkce_verifier_ciphertext,
    verifierNonce: record.pkce_verifier_nonce,
    encryptionKeyVersion: record.encryption_key_version
  } : null;
}

type TokenExchangeInput = {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
};

async function exchangeAuthorizationCode(input: TokenExchangeInput) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: input.redirectUri
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new ExternalRequestError('token_exchange_failed', response.status);
  const payload = await response.json();
  return {
    accessToken: typeof payload.access_token === 'string' ? payload.access_token : null,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : null
  };
}

async function fetchUserInfo(accessToken: string) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new ExternalRequestError('userinfo_failed', response.status);
  const payload = await response.json();
  return {
    sub: typeof payload.sub === 'string' ? payload.sub : null,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: payload.email_verified === true
  };
}

type ConnectionRecord = {
  userId: string;
  googleSubjectHash: string;
  googleAccountHint: string | null;
  calendarId: 'primary';
  grantedScopes: string[];
  connectionStatus: 'connected';
  tokenType: string | null;
  refreshCredential: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    encryptionKeyVersion: number;
  } | null;
};

async function persistConnection(record: ConnectionRecord): Promise<void> {
  await sql.begin(async (transaction: TransactionSql) => {
    const existingConnections = await transaction<{
      id: string;
      user_id: string;
      google_subject_hash: string | null;
    }[]>`
      select id, user_id, google_subject_hash
      from public.google_calendar_connections
      where user_id = ${record.userId}::uuid
      for update
    `;
    const existingConnection = existingConnections[0] ?? null;
    if (existingConnection && existingConnection.user_id !== record.userId) {
      throw new Error('connection_owner_mismatch');
    }

    const existingCredentials = existingConnection
      ? await transaction<{ connection_id: string }[]>`
          select connection_id
          from private.google_calendar_credentials
          where connection_id = ${existingConnection.id}::uuid
            and user_id = ${record.userId}::uuid
          for update
        `
      : [];

    const credentialAction = decideRefreshCredential({
      existingSubjectHash: existingConnection?.google_subject_hash ?? null,
      hasExistingCredential: Boolean(existingCredentials[0]),
      newSubjectHash: record.googleSubjectHash,
      hasNewRefreshToken: Boolean(record.refreshCredential)
    });

    if (credentialAction === 'preserve') {
      if (!existingConnection) throw new Error('missing_refresh_token');
      const connections = await transaction<{ id: string; user_id: string }[]>`
        update public.google_calendar_connections
        set
          google_account_hint = ${record.googleAccountHint},
          calendar_id = ${record.calendarId},
          granted_scopes = ${transaction.array(record.grantedScopes)}::text[],
          connection_status = ${record.connectionStatus},
          last_error_code = null
        where id = ${existingConnection.id}::uuid
          and user_id = ${record.userId}::uuid
          and google_subject_hash = ${record.googleSubjectHash}
        returning id, user_id
      `;
      const connection = connections[0];
      if (!connection || connection.user_id !== record.userId) {
        throw new Error('account_switch_requires_refresh_token');
      }
      const preserved = await transaction<{ connection_id: string }[]>`
        update private.google_calendar_credentials
        set token_type = ${record.tokenType}
        where connection_id = ${connection.id}::uuid
          and user_id = ${record.userId}::uuid
        returning connection_id
      `;
      if (!preserved[0]) throw new Error('missing_refresh_token');
      return;
    }

    const connections = await transaction<{ id: string; user_id: string }[]>`
      insert into public.google_calendar_connections (
        user_id, google_subject_hash, google_account_hint, calendar_id,
        granted_scopes, connection_status, last_error_code
      ) values (
        ${record.userId}::uuid,
        ${record.googleSubjectHash},
        ${record.googleAccountHint},
        ${record.calendarId},
        ${transaction.array(record.grantedScopes)}::text[],
        ${record.connectionStatus},
        null
      )
      on conflict (user_id) do update set
        google_subject_hash = excluded.google_subject_hash,
        google_account_hint = excluded.google_account_hint,
        calendar_id = excluded.calendar_id,
        granted_scopes = excluded.granted_scopes,
        connection_status = excluded.connection_status,
        last_error_code = null
      returning id, user_id
    `;
    const connection = connections[0];
    if (!connection || connection.user_id !== record.userId || !record.refreshCredential) {
      throw new Error('connection_owner_mismatch');
    }

    const credentials = await transaction<{ connection_id: string }[]>`
      insert into private.google_calendar_credentials (
        connection_id, user_id, refresh_token_ciphertext,
        refresh_token_nonce, encryption_key_version, token_type
      ) values (
        ${connection.id}::uuid,
        ${record.userId}::uuid,
        decode(${bytesToHex(record.refreshCredential.ciphertext)}, 'hex'),
        decode(${bytesToHex(record.refreshCredential.nonce)}, 'hex'),
        ${record.refreshCredential.encryptionKeyVersion},
        ${record.tokenType}
      )
      on conflict (connection_id) do update set
        user_id = excluded.user_id,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        refresh_token_nonce = excluded.refresh_token_nonce,
        encryption_key_version = excluded.encryption_key_version,
        token_type = excluded.token_type
      where private.google_calendar_credentials.user_id = excluded.user_id
      returning connection_id
    `;
    if (!credentials[0]) throw new Error('connection_owner_mismatch');
  });
}

const handler = createOAuthCallbackHandler({
  validateSchema,
  consumeOAuthState,
  exchangeAuthorizationCode,
  fetchUserInfo,
  persistConnection,
  getEnv: (name: string) => Deno.env.get(name),
  logger: console
});

Deno.serve(handler);
