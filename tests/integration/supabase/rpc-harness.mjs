const TYPES = new Set(['applications', 'application_plans', 'scheduled_applications', 'application_site_records', 'application_effect_notes', 'medication_vials', 'vial_usages']);
const EDGES = new Map([
  ['application_site_records', ['applications', 'scheduled_applications']],
  ['application_effect_notes', ['applications']],
  ['vial_usages', ['applications', 'medication_vials']],
  ['scheduled_applications', ['application_plans', 'applications']]
]);
export class RpcHarnessError extends Error { constructor(code) { super(code); this.code = code; } }
export function createRpcLedger({ qaRunId, userA, userB }) { return { qaRunId, users: new Set([userA, userB]), created: [], mutated: [], failures: [], cleanupFailures: [] }; }
export function registerCreated(ledger, resource) {
  if (!TYPES.has(resource.table)) throw new RpcHarnessError('UNTRACKED_RESOURCE_TYPE');
  if (!resource.primaryKey || !ledger.users.has(resource.ownerUserId) || !resource.cleanupStrategy) throw new RpcHarnessError('INVALID_LEDGER_RESOURCE');
  ledger.created.push({ status: 'CREATED', parentResource: null, cleanupStatus: 'PENDING', ...resource });
  return ledger.created.at(-1);
}
export function registerMutated(ledger, resource) { ledger.mutated.push({ status: 'MUTATED', ...resource }); }
export function registerRemoved(ledger, table, primaryKey, ownerUserId) {
  const row = ledger.created.find((r) => r.table === table && r.primaryKey === primaryKey && r.ownerUserId === ownerUserId);
  if (!row) throw new RpcHarnessError('UNTRACKED_RPC_EFFECT');
  row.status = 'REMOVED'; row.cleanupStatus = 'ALREADY_CLEAN'; return row;
}
export function createVialFixture(ledger, { primaryKey, ownerUserId, createdByStep = 'fixture' }) {
  return registerCreated(ledger, { table: 'medication_vials', primaryKey, ownerUserId, createdByStep, cleanupStrategy: 'delete' });
}
export function cleanupPlan(ledger) {
  const resources = ledger.created.filter((r) => r.status !== 'REMOVED'); const byKey = new Map(resources.map((r) => [`${r.table}:${r.primaryKey}`, r]));
  for (const r of resources) {
    if (!r.cleanupStrategy) throw new RpcHarnessError('CLEANUP_STRATEGY_REQUIRED');
    if (!ledger.users.has(r.ownerUserId)) throw new RpcHarnessError('CLEANUP_OWNERSHIP_UNVERIFIED');
    if (r.parentResource && !byKey.has(`${r.parentResource.table}:${r.parentResource.primaryKey}`)) throw new RpcHarnessError('UNKNOWN_PARENT_RESOURCE');
    if (r.table === 'scheduled_applications' && r.completed) throw new RpcHarnessError('CLEANUP_PATH_NOT_AVAILABLE');
  }
  const rank = (r) => ({ vial_usages: -2, application_site_records: -2, application_effect_notes: -2, applications: -1, scheduled_applications: -1, application_plans: 0, medication_vials: 0 }[r.table] ?? 0);
  return resources.sort((a, b) => rank(a) - rank(b)).map((r) => ({ table: r.table, primaryKey: r.primaryKey, ownerUserId: r.ownerUserId, strategy: r.cleanupStrategy }));
}
export async function runDryCleanup({ ledger, sessionUserId, remove }) {
  const plan = cleanupPlan(ledger); const result = [];
  for (const item of plan) {
    if (item.ownerUserId !== sessionUserId) throw new RpcHarnessError('CLEANUP_OWNERSHIP_UNVERIFIED');
    const row = ledger.created.find((r) => r.table === item.table && r.primaryKey === item.primaryKey);
    const status = await remove({ table: item.table, primaryKey: item.primaryKey });
    row.cleanupStatus = status === 'NOT_FOUND' ? 'ALREADY_CLEAN' : status;
    result.push(row.cleanupStatus);
  }
  return result;
}
export async function reconcileClean(ledger, exists) {
  for (const row of ledger.created) {
    if (row.status === 'REMOVED') continue;
    if (await exists({ table: row.table, primaryKey: row.primaryKey })) throw new RpcHarnessError('CLEANUP_RESIDUE_FOUND');
  }
  return 'CLEAN';
}
export function rpcDryRun({ ledger, execute }) { if (execute) throw new RpcHarnessError('RPC_HARNESS_DRY_RUN_ONLY'); return cleanupPlan(ledger); }
