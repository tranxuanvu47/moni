const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['android/**', '.expo/**', 'dist/**', 'node_modules/**', 'local-secrets/**']),
  expoConfig,
]);
