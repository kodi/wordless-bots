// What Vite puts on `import.meta.env` when it bundles the Worker (`vp dev`, `vp build`) and in `vp test`.
interface ImportMetaEnv {
  readonly MODE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
