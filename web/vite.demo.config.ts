// Build da prévia publicada: um único HTML com JS, CSS e fontes embutidos.
import { defineConfig, mergeConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

export default mergeConfig(
  { ...base, build: {} },
  defineConfig({
    plugins: [viteSingleFile()],
    build: { outDir: 'dist-demo', assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  }),
);
