import js from '@eslint/js';
import globals from 'globals';

export default [
    // Global ignores — applies to all subsequent config entries.
    {
        ignores: [
            'node_modules/**',
            '.claude/**',         // Agent worktrees and session data
            'functions/**',       // Cloud Functions: CommonJS, separate ESLint setup if needed
            'scripts/**',         // Dev utilities: bump-version, generate-roster-members
            '*.test.mjs',         // Test files — use test-runner globals, not browser
            '*.test.js',
            'purify.es.mjs',      // Vendor bundle — do not lint
            'service-worker.js',  // SW global scope: self, caches, clients (non-browser)
            'generate-sri.mjs',   // Dev utility
        ],
    },
    // ESLint recommended baseline.
    js.configs.recommended,
    // App-specific language options and rule overrides.
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // Catch bindings and vars named _ are intentionally unused (no-op catch / destructure discard).
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // Intentional empty catch blocks are allowed; empty function bodies are not.
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-console': 'off',
        },
    },
    // mammoth is loaded via CDN <script> in admin.html — not an ES module import.
    {
        files: ['huddle.js'],
        languageOptions: {
            globals: { mammoth: 'readonly' },
        },
    },
];
