// The inline build embeds the WebAssembly binary, so no .wasm file has to be located at runtime.
declare module 'sql.js/dist/sql-wasm-inline.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
