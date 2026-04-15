module.exports = (async () => {
  const base = (await import('@commitlint/config-conventional')).default;
  const defaultTypes = base.rules['type-enum'][2];
  return {
    extends: ['@commitlint/config-conventional'],
    ignores: [(message) => message.startsWith('Merge')],
    rules: {
      'type-enum': [2, 'always', [...defaultTypes, 'ratchet'].sort()],
    },
  };
})();
