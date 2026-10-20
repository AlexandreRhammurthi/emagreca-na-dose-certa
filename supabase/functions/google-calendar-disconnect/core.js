export const ALLOWED_ORIGINS = Object.freeze(new Set([
  'http://localhost:8000',
  'https://emagrecanadosecerta.com.br',
  'https://emagreca-na-dose-certa.arbandeira.workers.dev'
]));

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function readBearerToken(request) {
  const match = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.get('Authorization') || '');
  return match?.[1] || null;
}

export function createGoogleCalendarDisconnectHandler({ authenticate, disconnect, logger = console }) {
  return async function handleGoogleCalendarDisconnect(request) {
    const correlationId = crypto.randomUUID();
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse(403, { error: 'Origin not allowed' }, null);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' }, origin);

    const jwt = readBearerToken(request);
    if (!jwt) return jsonResponse(401, { error: 'Authentication required' }, origin);
    let userId = null;
    try {
      userId = await authenticate(jwt);
      if (!userId) return jsonResponse(401, { error: 'Authentication required' }, origin);
      await disconnect(userId);
      return jsonResponse(200, { success: true }, origin);
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_jwt') {
        return jsonResponse(401, { error: 'Authentication required' }, origin);
      }
      logger.error({
        operation: 'google_calendar_disconnect',
        correlation_id: correlationId,
        user_id: userId,
        category: error instanceof Error && error.message === 'schema_mismatch' ? 'schema_mismatch' : 'internal_error'
      });
      return jsonResponse(500, { error: 'Unable to disconnect Google Calendar' }, origin);
    }
  };
}
