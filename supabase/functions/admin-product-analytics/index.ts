import { createClient } from 'npm:@supabase/supabase-js@2.100.0';

const ALLOWED_ORIGINS = new Set(['http://localhost:8000', 'https://emagrecanadosecerta.com.br', 'https://emagreca-na-dose-certa.arbandeira.workers.dev']);
const EVENT_NAMES = new Set(['account_created', 'onboarding_completed', 'first_product_action', 'product_returned']);
const ACTION_KINDS = new Set(['application', 'weight', 'plan', 'google_calendar']);
const RETENTION_DAYS = 30;
const CENSUS_MIN_GROUP_SIZE = 5;

type ProductEvent = { user_id: string; event_name: string; action_kind: string; simulated_in_session: boolean; event_day: string };
type ProfileAccount = { id: string; created_at: string };
type CensusProfile = { date_of_birth: string | null; gender: string | null; city: string | null; state: string | null };

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

function response(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' } });
}

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function publishableKey() {
  const legacyKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyKey) return legacyKey;
  const keyMap = JSON.parse(required('SUPABASE_PUBLISHABLE_KEYS')) as Record<string, string>;
  const key = keyMap.default || Object.values(keyMap)[0];
  if (!key) throw new Error('missing_supabase_publishable_key');
  return key;
}

function isoDay(date: Date) { return date.toISOString().slice(0, 10); }
function previousDay(day: string, days: number) { const value = new Date(`${day}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() - days); return isoDay(value); }
function nextDay(day: string, days: number) { const value = new Date(`${day}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return isoDay(value); }
function ratio(numerator: number, denominator: number) { return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0; }
function uniqueUsers(events: ProductEvent[]) { return new Set(events.map((event) => event.user_id)); }

function ageBand(dateOfBirth: string | null, today: Date) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  if (age < 18 || age > 120) return null;
  if (age <= 24) return '18–24 anos';
  if (age <= 34) return '25–34 anos';
  if (age <= 44) return '35–44 anos';
  if (age <= 54) return '45–54 anos';
  if (age <= 64) return '55–64 anos';
  return '65 anos ou mais';
}

function aggregateCensus(values: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const visible = [...counts.entries()]
    .filter(([, count]) => count >= CENSUS_MIN_GROUP_SIZE)
    .sort(([leftLabel, leftCount], [rightLabel, rightCount]) => rightCount - leftCount || leftLabel.localeCompare(rightLabel, 'pt-BR'))
    .map(([label, count]) => ({ label, count }));
  const suppressed = [...counts.values()].filter((count) => count < CENSUS_MIN_GROUP_SIZE).reduce((sum, count) => sum + count, 0);
  if (suppressed) visible.push({ label: 'Outros grupos', count: suppressed });
  return visible;
}

function censusGenderLabel(gender: string | null) {
  return ({ woman_cis_trans: 'Mulher (Cis ou Trans)', man_cis_trans: 'Homem (Cis ou Trans)', non_binary: 'Não-binário', prefer_not_to_answer: 'Prefiro não responder', other: 'Outro' } as Record<string, string>)[gender || ''] || null;
}

function censusCityLabel(city: string | null, state: string | null) {
  const normalizedCity = city?.trim().replace(/\s+/g, ' ');
  const normalizedState = state?.trim().toUpperCase();
  return normalizedCity ? `${normalizedCity}${normalizedState ? ` — ${normalizedState}` : ''}` : null;
}

async function loadCensusProfiles(serverClient: ReturnType<typeof createClient>) {
  const profiles: CensusProfile[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await serverClient.from('onboarding_profiles')
      .select('date_of_birth,gender,city,state')
      .not('completed_at', 'is', null)
      .range(start, start + pageSize - 1);
    if (error) throw new Error('census_query_failed');
    const page = (data || []).filter((profile): profile is CensusProfile => typeof profile === 'object' && profile !== null);
    profiles.push(...page);
    if (page.length < pageSize) return profiles;
  }
}

function buildInsights(metrics: Record<string, number>, recentAccounts: number, previousAccounts: number) {
  if (recentAccounts < 30) return [];
  const insights: Array<{ title: string; message: string; recommendation: string }> = [];
  if (metrics.onboarding_completion_rate < 0.65) insights.push({ title: 'Conclusão de onboarding abaixo do limiar', message: 'Menos de 65% das contas do período concluíram o onboarding.', recommendation: 'Avaliar onboarding progressivo e salvamento por etapa.' });
  if (metrics.activation_rate < 0.4) insights.push({ title: 'Ativação inicial abaixo do limiar', message: 'Menos de 40% das contas realizaram uma primeira ação de produto.', recommendation: 'Priorizar checklist de primeiros passos no Diário.' });
  if (metrics.d7_return_rate < 0.3) insights.push({ title: 'Retorno D7 abaixo do limiar', message: 'Menos de 30% da coorte elegível retornou no sétimo dia.', recommendation: 'Avaliar check-in semanal e lembrete de registro de peso.' });
  if (previousAccounts > 0 && recentAccounts / previousAccounts < 0.7) insights.push({ title: 'Queda recente de novas contas', message: 'Os últimos 7 dias têm pelo menos 30% menos contas que o histórico anterior equivalente.', recommendation: 'Investigar aquisição e a jornada inicial do simulador.' });
  return insights;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response({ error: 'origin_not_allowed' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405, origin);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return response({ error: 'unauthorized' }, 401, origin);

  try {
    const url = required('SUPABASE_URL');
    const key = publishableKey();
    const allowedEmail = required('ADMIN_ANALYTICS_ALLOWED_EMAIL').trim().toLowerCase();
    const userClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: authorization } } });
    const { data: authData, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    if (authError || !authData.user?.email) return response({ error: 'unauthorized' }, 401, origin);
    if (authData.user.email.trim().toLowerCase() !== allowedEmail) return response({ error: 'access_denied' }, 403, origin);

    const serverClient = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const cutoff = isoDay(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
    const endDay = isoDay(new Date());
    const startDay = previousDay(endDay, RETENTION_DAYS - 1);
    const { error: cleanupError } = await serverClient.from('product_events').delete().lt('occurred_at', `${cutoff}T00:00:00.000Z`);
    if (cleanupError) throw new Error('retention_cleanup_failed');
    const { count: totalRegisteredUsers, error: totalAccountsError } = await serverClient
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    if (totalAccountsError) throw new Error('total_accounts_query_failed');
    const { data: profileData, error: profileError } = await serverClient
      .from('profiles')
      .select('id,created_at')
      .gte('created_at', `${startDay}T00:00:00.000Z`)
      .lt('created_at', `${nextDay(endDay, 1)}T00:00:00.000Z`);
    if (profileError) throw new Error('account_cohort_query_failed');
    const censusProfiles = await loadCensusProfiles(serverClient);
    const { data, error } = await serverClient.from('product_events').select('user_id,event_name,action_kind,simulated_in_session,event_day').gte('event_day', startDay).lte('event_day', endDay);
    if (error) throw new Error('aggregate_query_failed');

    const events = (data || []).filter((event): event is ProductEvent => EVENT_NAMES.has(event.event_name) && typeof event.user_id === 'string' && typeof event.event_day === 'string');
    const byName = (name: string) => events.filter((event) => event.event_name === name);
    const accountEvents = byName('account_created');
    // O cadastro é a fonte de verdade para contas novas. account_created é
    // telemetria de frontend, portanto pode inexistir para contas anteriores.
    const accounts = (profileData || []).filter((profile): profile is ProfileAccount => typeof profile.id === 'string' && typeof profile.created_at === 'string');
    const accountUsers = new Set(accounts.map((profile) => profile.id));
    const onboardingUsers = uniqueUsers(byName('onboarding_completed'));
    const actionUsers = uniqueUsers(byName('first_product_action'));
    const returnUsers = uniqueUsers(byName('product_returned'));
    const simulatedAccounts = uniqueUsers(accountEvents.filter((event) => event.simulated_in_session && accountUsers.has(event.user_id)));
    const d7Eligible = accounts.filter((account) => nextDay(isoDay(new Date(account.created_at)), 7) <= endDay);
    const d7Returned = new Set(d7Eligible.filter((account) => events.some((event) => event.user_id === account.id && event.event_name === 'product_returned' && event.event_day === nextDay(isoDay(new Date(account.created_at)), 7))).map((account) => account.id));
    const adoption = Object.fromEntries([...ACTION_KINDS].map((kind) => [kind, uniqueUsers(byName('first_product_action').filter((event) => event.action_kind === kind)).size]));
    const recentStart = previousDay(endDay, 6);
    const priorStart = previousDay(endDay, 13);
    const recentAccounts = accounts.filter((account) => isoDay(new Date(account.created_at)) >= recentStart).length;
    const previousAccounts = accounts.filter((account) => { const day = isoDay(new Date(account.created_at)); return day >= priorStart && day < recentStart; }).length;
    const census = {
      total_registered_users: totalRegisteredUsers || 0,
      profiled_users: censusProfiles.length,
      minimum_group_size: CENSUS_MIN_GROUP_SIZE,
      gender: aggregateCensus(censusProfiles.map((profile) => censusGenderLabel(profile.gender))),
      age_bands: aggregateCensus(censusProfiles.map((profile) => ageBand(profile.date_of_birth, new Date()))),
      cities: aggregateCensus(censusProfiles.map((profile) => censusCityLabel(profile.city, profile.state)))
    };
    const metrics = {
      total_registered_users: census.total_registered_users,
      new_accounts: accounts.length,
      onboarding_completed: onboardingUsers.size,
      first_product_action: actionUsers.size,
      d7_returned: d7Returned.size,
      accounts_after_simulation: simulatedAccounts.size,
      onboarding_completion_rate: accountUsers.size ? ratio(onboardingUsers.size, accountUsers.size) : null,
      activation_rate: accountUsers.size ? ratio(actionUsers.size, accountUsers.size) : null,
      d7_return_rate: ratio(d7Returned.size, new Set(d7Eligible.map((account) => account.id)).size),
      simulation_to_account_rate: accountEvents.length && accountUsers.size ? ratio(simulatedAccounts.size, accountUsers.size) : null
    };
    return response({
      period: { days: RETENTION_DAYS, start: startDay, end: endDay, label: 'últimos 30 dias' },
      cohort_size: accountUsers.size,
      account_cohort_available: accountUsers.size > 0,
      simulation_telemetry_available: accountEvents.length > 0,
      sufficient_data: recentAccounts >= 30,
      metrics,
      funnel: { account_created: accountUsers.size, onboarding_completed: onboardingUsers.size, first_product_action: actionUsers.size, product_returned: returnUsers.size },
      adoption,
      census,
      insights: buildInsights(metrics, recentAccounts, previousAccounts)
    }, 200, origin);
  } catch (error) {
    console.error('admin-product-analytics failed', { category: error instanceof Error ? error.message : 'unknown' });
    return response({ error: 'analytics_unavailable' }, 500, origin);
  }
});
