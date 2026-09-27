import { readFile } from 'node:fs/promises';

const REQUIRED_ENV = Object.freeze([
  'TEST_TARGET',
  'TEST_SUPABASE_URL',
  'TEST_SUPABASE_PROJECT_REF',
  'TEST_SUPABASE_PUBLISHABLE_KEY',
  'TEST_ALLOW_QA_WRITE',
  'TEST_USERS_DISPOSABLE'
]);

export const KNOWN_PRODUCTION_PROJECT_REF = 'jxfjsleqwfjrkcxcqpvw';
const ADMINISTRATIVE_ENV_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SERVICE_ROLE_KEY',
  'TEST_SUPABASE_SERVICE_ROLE_KEY',
  'TEST_SUPABASE_SECRET_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD'
]);

function normalizeUrl(value) {
  return new URL(value).href.replace(/\/$/u, '');
}

function isKnownProduction(url, ref, productionUrl, productionProjectRef) {
  return ref === productionProjectRef
    || (productionUrl && normalizeUrl(url.href) === normalizeUrl(productionUrl));
}

export function validateQaEnvironment(env, { productionUrl, productionProjectRef = KNOWN_PRODUCTION_PROJECT_REF } = {}) {
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Configuração de teste ausente: ${missing.join(', ')}.`);
  if (!['qa', 'production-qa'].includes(env.TEST_TARGET)) throw new Error('TEST_TARGET deve ser qa ou production-qa.');
  if (env.TEST_ALLOW_QA_WRITE !== 'true') throw new Error('TEST_ALLOW_QA_WRITE deve ser exatamente true.');
  if (env.TEST_USERS_DISPOSABLE !== 'true') throw new Error('TEST_USERS_DISPOSABLE deve ser exatamente true.');

  const administrativeVariable = ADMINISTRATIVE_ENV_NAMES.find((name) => env[name]);
  if (administrativeVariable) throw new Error(`Credencial administrativa proibida: ${administrativeVariable}.`);

  let url;
  try {
    url = new URL(env.TEST_SUPABASE_URL);
  } catch {
    throw new Error('TEST_SUPABASE_URL inválida.');
  }
  if (!/^[a-z0-9-]+$/u.test(env.TEST_SUPABASE_PROJECT_REF)) throw new Error('TEST_SUPABASE_PROJECT_REF inválida.');
  if (
    url.protocol !== 'https:'
    || url.hostname !== `${env.TEST_SUPABASE_PROJECT_REF}.supabase.co`
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
  ) throw new Error('A URL não corresponde ao project ref declarado.');

  if (/^(?:sb_secret_|service_role|eyJ)/iu.test(env.TEST_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('TEST_SUPABASE_PUBLISHABLE_KEY não pode conter credencial administrativa ou JWT.');
  }
  if (!env.TEST_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('TEST_SUPABASE_PUBLISHABLE_KEY deve ser uma publishable key.');
  }

  const production = isKnownProduction(url, env.TEST_SUPABASE_PROJECT_REF, productionUrl, productionProjectRef);
  if (env.TEST_TARGET === 'qa' && production) throw new Error('O destino conhecido de produção é proibido no modo qa.');
  if (env.TEST_TARGET === 'production-qa') {
    if (!production) throw new Error('production-qa exige exatamente o destino de produção conhecido.');
    if (env.TEST_ALLOW_PRODUCTION_QA_WRITE !== 'true') {
      throw new Error('TEST_ALLOW_PRODUCTION_QA_WRITE deve ser exatamente true em production-qa.');
    }
  }

  return Object.freeze({ url: normalizeUrl(url.href), key: env.TEST_SUPABASE_PUBLISHABLE_KEY, mode: env.TEST_TARGET });
}

export async function loadQaEnvironment(env = process.env) {
  const productionConfig = await readFile(new URL('../../../js/supabase-config.js', import.meta.url), 'utf8');
  const productionUrl = productionConfig.match(/const\s+SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/u)?.[1];
  if (!productionUrl) throw new Error('Não foi possível identificar o endpoint de produção para bloqueio.');
  return validateQaEnvironment(env, { productionUrl });
}
