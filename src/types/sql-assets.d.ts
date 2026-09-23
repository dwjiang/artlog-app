// babel-plugin-inline-import bundles `.sql` migration files as strings (babel.config.js).
declare module "*.sql" {
  const sql: string;
  export default sql;
}
