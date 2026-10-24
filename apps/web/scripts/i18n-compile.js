// Compiles messages/*.json into src/lib/paraglide without vite, for
// `check` / `check-types`, which type-check the generated modules.
import { compile } from '@inlang/paraglide-js';
import { paraglideOptions } from '../paraglide.options.js';

await compile({ ...paraglideOptions, isServer: "typeof window === 'undefined'" });
