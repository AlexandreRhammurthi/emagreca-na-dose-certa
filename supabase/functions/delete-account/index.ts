import { createClient } from 'npm:@supabase/supabase-js@2.100.0';

const response = (body: Record<string, string>, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; };
const publishableKey = () => {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyKey) return legacyKey;
  const keyMap = JSON.parse(required('SUPABASE_PUBLISHABLE_KEYS')) as Record<string, string>;
  const key = keyMap.default || Object.values(keyMap)[0];
  if (!key) throw new Error('missing_supabase_publishable_key');
  return key;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return response({ error: 'unauthorized' }, 401);
  try {
    const url = required('SUPABASE_URL'); const key = publishableKey(); const adminKey = required('SUPABASE_SERVICE_ROLE_KEY');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user?.id || !data.user.email) return response({ error: 'unauthorized' }, 401);
    const { password } = await request.json();
    if (typeof password !== 'string' || password.length < 6) return response({ error: 'reauthentication_required' }, 400);
    const verified = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.user.email, password }) });
    const reauth = await verified.json().catch(() => null);
    if (!verified.ok || reauth?.user?.id !== data.user.id) return response({ error: 'reauthentication_failed' }, 403);
    const admin = createClient(url, adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error: deletionError } = await admin.auth.admin.deleteUser(data.user.id, false);
    if (deletionError) return response({ error: 'deletion_failed' }, 500);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('delete-account failed', { category: error instanceof Error ? error.message : 'unknown' });
    return response({ error: 'deletion_failed' }, 500);
  }
});
