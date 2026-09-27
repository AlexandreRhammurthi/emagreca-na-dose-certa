import { randomUUID } from 'node:crypto';

export function createQaRunId({ now = Date.now, uuid = randomUUID } = {}) {
  return `qa-${Number(now()).toString(36)}-${String(uuid()).replace(/-/gu, '').slice(0, 10)}`;
}

export function assertNoPreexistingRows(rows) {
  const populated = rows.filter(({ count }) => Number(count) > 0).map(({ table }) => table);
  if (populated.length) {
    throw new Error(`Dados pré-existentes impedem o teste QA: ${populated.join(', ')}.`);
  }
}

export function assertDistinctUserIds(userA, userB) {
  if (!userA || !userB || userA === userB) throw new Error('USER A e USER B devem representar identidades distintas.');
}

export function createCreatedRecordTracker(allowedTables) {
  const allowed = new Set(allowedTables);
  const records = [];

  function register({ table, id, idColumn = 'id', client, ownerLabel }) {
    if (!allowed.has(table)) throw new Error(`Tabela não autorizada para cleanup: ${table}.`);
    if (!id || !idColumn || !client) throw new Error('Cleanup requer ID, coluna de ID e cliente do proprietário.');
    records.push({ table, id, idColumn, client, ownerLabel, removed: false });
  }

  return Object.freeze({ records, register });
}
