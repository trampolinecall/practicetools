import css from 'rollup-plugin-css-only';
import livereload from 'rollup-plugin-livereload'
import resolve from '@rollup/plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import svelte from 'rollup-plugin-svelte';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

import { sveltePreprocess } from 'svelte-preprocess';

const production = !process.env.ROLLUP_WATCH;

export default {
    input: 'src/main.ts',

    output: {
        sourcemap: true,
        format: 'iife',
        name: 'app',
        file: 'dist/build/bundle.js',
    },

    plugins: [
        svelte({
            preprocess: sveltePreprocess(),
        }),

        typescript({ sourceMap: true }),

        css({ output: 'bundle.css' }),

        !production && serve('dist'),
        !production && livereload('dist'),

        production && terser(),

        resolve({
            browser: true,
        }),
    ],

};
