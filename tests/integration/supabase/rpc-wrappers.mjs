import { RpcHarnessError, registerCreated, registerMutated, registerRemoved, cleanupPlan } from './rpc-harness.mjs';

export const RPC_CONTRACTS = Object.freeze({
  create_application_with_optional_vial: Object.freeze({ required: ['p_application_date','p_medicine','p_vial_mg','p_vial_ml','p_dose_mg','p_syringe_capacity'], optional: ['p_application_notes','p_medication_vial_id'], returns: ['application_id','vial_usage_id'], creates: ['applications','vial_usages'], mayMutate: ['medication_vials'] }),
  update_application_with_optional_vial: Object.freeze({ required: ['p_application_id','p_application_date','p_medicine','p_vial_mg','p_vial_ml','p_dose_mg','p_syringe_capacity'], optional: ['p_application_notes','p_medication_vial_id'], returns: ['application_id','vial_usage_id'], creates: ['vial_usages'], mayMutate: ['applications','medication_vials'] })
});

function requireCreatedApplication(ledger, id, ownerUserId) {
  const row = ledger.created.find((r) => r.table === 'applications' && r.primaryKey === id);
  if (!row || row.ownerUserId !== ownerUserId) throw new RpcHarnessError('PREEXISTING_RESOURCE_MUTATION_REQUIRED');
  return row;
}
function observe(ledger, effects, ownerUserId, step) {
  const seen = new Set();
  for (const effect of effects) {
    if (!effect?.table || !effect.primaryKey || seen.has(`${effect.table}:${effect.primaryKey}`)) throw new RpcHarnessError('AMBIGUOUS_RPC_EFFECT');
    seen.add(`${effect.table}:${effect.primaryKey}`);
    if (effect.ownerUserId !== ownerUserId) throw new RpcHarnessError('CLEANUP_OWNERSHIP_UNVERIFIED');
    if (!['applications','medication_vials','vial_usages'].includes(effect.table)) throw new RpcHarnessError('UNEXPECTED_RESOURCE');
    if (effect.state === 'MUTATED') registerMutated(ledger, { ...effect, createdByStep: step });
    else registerCreated(ledger, { ...effect, createdByStep: step, cleanupStrategy: 'delete' });
  }
}
export async function runRpc1Dry({ ledger, ownerUserId, executor, payload }) {
  const result = await executor({ rpc: 'create_application_with_optional_vial', payload });
  if (!result?.application_id) throw new RpcHarnessError('UNTRACKED_RPC_EFFECT');
  observe(ledger, [{ table:'applications', primaryKey:result.application_id, ownerUserId, state:'CREATED' }, ...(result.effects || [])], ownerUserId, 'RPC-1');
  return { plan: cleanupPlan(ledger), result };
}
export async function runRpc2Dry({ ledger, ownerUserId, applicationId, previousUsageId = null, executor, payload }) {
  requireCreatedApplication(ledger, applicationId, ownerUserId);
  const result = await executor({ rpc: 'update_application_with_optional_vial', payload: { ...payload, p_application_id: applicationId } });
  if (result?.application_id !== applicationId) throw new RpcHarnessError('AMBIGUOUS_RPC_EFFECT');
  registerMutated(ledger, { table:'applications', primaryKey:applicationId, ownerUserId, state:'MUTATED', createdByStep:'RPC-2' });
  if (previousUsageId && result.vial_usage_id == null) registerRemoved(ledger, 'vial_usages', previousUsageId, ownerUserId);
  observe(ledger, result.effects || [], ownerUserId, 'RPC-2');
  return { plan: cleanupPlan(ledger), result };
}
