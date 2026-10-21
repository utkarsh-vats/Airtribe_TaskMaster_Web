import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'coverage/**',
        'next-env.d.ts',
        'src/lib/api/schema.d.ts',
        'design/prototype/**',
        'local_docs/**',
    ]),
    ...nextVitals,
    ...nextTs,
    {
        files: ['**/*.{ts,tsx,mts}'],
        extends: [tseslint.configs.strict],
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    // Last: turn off rules that conflict with Prettier.
    prettier,
]);
