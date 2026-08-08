(function configureSupabase() {
  'use strict';

  // Valores públicos do projeto: Supabase Dashboard > Project Settings > API.
  const SUPABASE_URL = 'https://jxfjsleqwfjrkcxcqpvw.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_IX5rRSc9GW6r1iFICQxjxg_UPQ9n9u1';

  const isConfigured =
    /^https:\/\/.+\.supabase\.co$/.test(SUPABASE_URL) &&
    SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');

  window.supabaseConfigReady = isConfigured;
  window.supabaseClient = isConfigured && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;
})();
