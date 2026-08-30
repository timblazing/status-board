import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist-server/index.js',
  minify: true,
  banner: {
    // esm shim so bundled CJS deps (yaml) resolve require/__dirname
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
});
console.log('server bundled -> dist-server/index.js');
