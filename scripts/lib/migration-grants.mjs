// Supabase stops granting new public tables and sequences to anon,
// authenticated and service_role by default on existing projects from
// 2026-10-30. Tables created before then keep their grants. Every table or
// sequence a later migration creates must therefore carry its own explicit
// service_role grant (and RLS), or the API's service-role calls fail in
// production while local tests that grant broadly still pass.
const NAME = '(?:"?public"?\\.)?"?([a-z_][a-z0-9_]*)"?';

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function names(list) {
  return list.split(',').map(part => part.trim().replace(/^"?public"?\./i, '').replace(/"/g, '').toLowerCase()).filter(Boolean);
}

// Statement-level grant targets for service_role: tables, sequences, and
// whole-schema grants. Function and schema-usage grants do not count.
function serviceRoleGrants(sql) {
  const tables = new Set(), sequences = new Set();
  let allTables = false, allSequences = false;
  for (const match of sql.matchAll(/\bgrant\s+([^;]+?)\s+on\s+([^;]+?)\s+to\s+([^;]+);/gi)) {
    const target = match[2].trim(), roles = names(match[3]);
    if (!roles.includes('service_role')) continue;
    if (/^all\s+tables\s+in\s+schema\s+"?public"?$/i.test(target)) allTables = true;
    else if (/^all\s+sequences\s+in\s+schema\s+"?public"?$/i.test(target)) allSequences = true;
    else if (/^sequence\s+/i.test(target)) names(target.replace(/^sequence\s+/i, '')).forEach(name => sequences.add(name));
    else if (!/^(function|procedure|routine|schema|all\s+functions|all\s+routines|all\s+procedures)\b/i.test(target)) {
      names(target.replace(/^table\s+/i, '')).forEach(name => tables.add(name));
    }
  }
  return { tables, sequences, allTables, allSequences };
}

export function migrationGrantProblems(source, file = 'migration.sql') {
  const sql = stripComments(source), problems = [], grants = serviceRoleGrants(sql);
  for (const match of sql.matchAll(new RegExp(`\\bcreate\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}\\s*\\(`, 'gi'))) {
    const table = match[1].toLowerCase();
    const rls = new RegExp(`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:"?public"?\\.)?"?${table}"?\\s+enable\\s+row\\s+level\\s+security`, 'i');
    if (!rls.test(sql)) problems.push(`${file}: table ${table} must enable row level security`);
    if (!grants.allTables && !grants.tables.has(table)) problems.push(`${file}: table ${table} needs an explicit grant to service_role`);
    // A serial column creates <table>_<column>_seq, which also loses default grants.
    const body = sql.slice(match.index, sql.indexOf(';', match.index) + 1);
    for (const column of body.matchAll(/(?:\(|,)\s*"?([a-z_][a-z0-9_]*)"?\s+(?:small|big)?serial\b/gi)) {
      const sequence = `${table}_${column[1].toLowerCase()}_seq`;
      if (!grants.allSequences && !grants.sequences.has(sequence)) problems.push(`${file}: sequence ${sequence} needs an explicit grant to service_role`);
    }
  }
  for (const match of sql.matchAll(new RegExp(`\\bcreate\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}`, 'gi'))) {
    const sequence = match[1].toLowerCase();
    if (!grants.allSequences && !grants.sequences.has(sequence)) problems.push(`${file}: sequence ${sequence} needs an explicit grant to service_role`);
  }
  return problems;
}

export function createdTables(source) {
  const sql = stripComments(source);
  return [...sql.matchAll(new RegExp(`\\bcreate\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${NAME}\\s*\\(`, 'gi'))].map(match => match[1].toLowerCase());
}
