const blockedNetwork = () => {
  throw new Error('Acesso de rede bloqueado pela suíte local.');
};

Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: blockedNetwork,
  writable: true
});
