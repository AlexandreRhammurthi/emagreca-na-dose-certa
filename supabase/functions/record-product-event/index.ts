import { createClient } from 'npm:@supabase/supabase-js@2.100.0';

const ALLOWED_ORIGINS = new Set(['http://localhost:8000', 'https://emagrecanadosecerta.com.br', 'https://emagreca-na-dose-certa.arbandeira.workers.dev']);
const EVENT_NAMES = new Set(['account_created', 'onboarding_completed', 'first_product_action', 'product_returned']);
const SOURCES = new Set(['onboarding', 'diary', 'weight', 'plan', 'google_calendar']);
const ACTION_KINDS = new Set(['none', 'application', 'weight', 'plan', 'google_calendar']);
const ACTION_SOURCES: Record<string, string> = { application: 'diary', weight: 'weight', plan: 'plan', google_calendar: 'google_calendar' };
const allowedFields = new Set(['event_name', 'source', 'action_kind', 'simulated_in_session']);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const response = (body: Record<string, string>, status: number, origin: string | null = null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
};

const publishableKey = () => {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyKey) return legacyKey;
  const keyMap = JSON.parse(required('SUPABASE_PUBLISHABLE_KEYS')) as Record<string, string>;
  const key = keyMap.default || Object.values(keyMap)[0];
  if (!key) throw new Error('missing_supabase_publishable_key');
  return key;
};

function parseEvent(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((field) => !allowedFields.has(field))) return null;
  const eventName = body.event_name;
  const source = body.source;
  const actionKind = body.action_kind ?? 'none';
  const simulatedInSession = body.simulated_in_session ?? false;
  if (typeof eventName !== 'string' || !EVENT_NAMES.has(eventName)) return null;
  if (typeof source !== 'string' || !SOURCES.has(source)) return null;
  if (typeof actionKind !== 'string' || !ACTION_KINDS.has(actionKind)) return null;
  if (typeof simulatedInSession !== 'boolean') return null;
  if (eventName === 'first_product_action') {
    if (actionKind === 'none' || ACTION_SOURCES[actionKind] !== source || simulatedInSession) return null;
  } else if (actionKind !== 'none' || source !== 'onboarding' || (eventName !== 'account_created' && simulatedInSession)) return null;
  return { eventName, source, actionKind, simulatedInSession };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return response({ error: 'origin_not_allowed' }, 403, origin);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405, origin);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return response({ error: 'unauthorized' }, 401, origin);
  try {
    const url = required('SUPABASE_URL');
    const key = publishableKey();
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: authorization } }
    });
    const { data: authData, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !authData.user?.id) return response({ error: 'unauthorized' }, 401, origin);
    const event = parseEvent(await request.json().catch(() => null));
    if (!event) return response({ error: 'invalid_event' }, 400, origin);
    const { error } = await client.from('product_events').insert({
      user_id: authData.user.id,
      event_name: event.eventName,
      source: event.source,
      action_kind: event.actionKind,
      simulated_in_session: event.simulatedInSession
    });
    if (error && error.code !== '23505') return response({ error: 'event_not_recorded' }, 500, origin);
    return new Response(null, { status: 204, headers: { ...corsHeaders(origin), 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('record-product-event failed', { category: error instanceof Error ? error.message : 'unknown' });
    return response({ error: 'event_not_recorded' }, 500, origin);
  }
});
