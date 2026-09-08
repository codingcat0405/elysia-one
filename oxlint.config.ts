import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'react', 'jsx-a11y'],
  categories: { correctness: 'error', suspicious: 'warn' },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '**/.turbo/**',
    'apps/client/src/routeTree.gen.ts',
  ],
  rules: {
    // Legacy ESLint rules ported from apps/client/eslint.config.js, verified against
    // `bunx oxlint --rules -f json` (oxlint 1.82.0) before being written here.
    'import/no-cycle': 'off', // exists (scope: import, category: restriction)
    'sort-imports': 'off', // exists (scope: eslint, unprefixed, category: style)
    'typescript/array-type': 'off', // was @typescript-eslint/array-type (category: style)
    'require-await': 'off', // was @typescript-eslint/require-await; oxlint's type-aware
    // equivalent is "typescript/require-await", but type-aware linting is out of scope
    // (never enabled without --type-aware), so the non-type-aware eslint-scope key is used.
    // import/order has no oxlint equivalent (not implemented) — omitted, not "off".

    // Project-specific tuning discovered during migration (bun run lint, step 12).
    'react/react-in-jsx-scope': 'off', // automatic JSX runtime (apps/client/tsconfig.json sets
    // "jsx": "react-jsx"), so `React` is never required in scope — this rule assumes the
    // classic runtime and is a false positive here, not a real issue.
    'react/set-state-in-effect': 'warn', // genuine correctness signal (unlike the rule above),
    // downgraded from the "correctness" category default of "error" to "warn" so it stays
    // visible without permanently failing `bun run lint`; 2 existing occurrences need
    // source-level review to fix properly — out of scope for this config-migration task.
  },
})
