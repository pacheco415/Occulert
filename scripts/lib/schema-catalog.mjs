// A deterministic schema-only catalog, without volatile OIDs or table data.
// Used only by the isolated baseline regression; not a production dump tool.
const queries = {
  schemas: `select nspname, nspacl::text as acl from pg_namespace where nspname='public' order by nspname`,
  relations: `select c.relname, c.relkind, c.relpersistence, pg_get_userbyid(c.relowner) as owner,
    c.relrowsecurity, c.relforcerowsecurity, c.relreplident, c.reloptions, c.relacl::text as acl,
    obj_description(c.oid, 'pg_class') as comment
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','S','f') order by c.relname`,
  columns: `select c.relname, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) as type,
    a.attnotnull, a.attidentity, a.attgenerated, a.attndims, a.attstorage, a.attcompression,
    pg_get_expr(d.adbin,d.adrelid) as default_expression, coll.collname as collation,
    a.attacl::text as acl, col_description(c.oid,a.attnum) as comment
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    left join pg_collation coll on coll.oid=a.attcollation
    where n.nspname='public' and a.attnum>0 and not a.attisdropped
      and c.relkind in ('r','p','v','m','S','f') order by c.relname,a.attnum`,
  constraints: `select c.relname, k.conname, k.contype, k.condeferrable, k.condeferred, k.convalidated,
    pg_get_constraintdef(k.oid,true) as definition from pg_constraint k
    join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname,k.conname`,
  indexes: `select c.relname, pg_get_indexdef(i.indexrelid) as definition, i.indisvalid, i.indisready,
    i.indislive, i.indisunique, i.indisprimary, i.indnullsnotdistinct
    from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname`,
  policies: `select c.relname, p.polname, p.polcmd, p.polpermissive,
    array(select case when r=0 then 'public' else pg_get_userbyid(r)::text end
      from unnest(p.polroles) r order by 1) as roles,
    pg_get_expr(p.polqual,p.polrelid) as using_expression,
    pg_get_expr(p.polwithcheck,p.polrelid) as check_expression
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname,p.polname`,
  functions: `select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_functiondef(p.oid) as definition, pg_get_userbyid(p.proowner) as owner,
    p.proacl::text as acl, p.prosecdef, p.proleakproof, p.provolatile, p.proparallel, p.proconfig,
    obj_description(p.oid,'pg_proc') as comment
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') order by p.proname,arguments`,
  types: `select t.typname, t.typtype, t.typnotnull, t.typdefault, t.typacl::text as acl,
    case when t.typbasetype=0 then null else format_type(t.typbasetype,t.typtypmod) end as base_type,
    array(select e.enumlabel from pg_enum e where e.enumtypid=t.oid order by e.enumsortorder) as enum_labels
    from pg_type t join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' and t.typtype in ('d','e') order by t.typname`,
  triggers: `select c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid,true) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname`,
  rules: `select c.relname, r.rulename, pg_get_ruledef(r.oid,true) as definition
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' order by c.relname,r.rulename`,
  sequences: `select schemaname, sequencename, sequenceowner, data_type, start_value, min_value,
    max_value, increment_by, cycle, cache_size from pg_sequences where schemaname='public' order by sequencename`,
  defaultPrivileges: `select pg_get_userbyid(d.defaclrole) as role, n.nspname, d.defaclobjtype,
    d.defaclacl::text as acl from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    where d.defaclnamespace=0 or n.nspname='public' order by role,n.nspname,d.defaclobjtype`,
};

export async function schemaCatalog(db) {
  const result = {};
  for (const [name, sql] of Object.entries(queries)) result[name] = (await db.query(sql)).rows;
  return result;
}
