# Multi-Database Strategy

## Overview

The system supports MySQL/MariaDB, PostgreSQL, and Oracle from a single codebase. Kysely ORM provides the query builder foundation, while custom abstractions handle database-specific differences.

```
                    ┌──────────────────┐
                    │   Kysely ORM     │
                    │  (Query Builder) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌─────────────┐
     │ MySQL/MariaDB│ │ PostgreSQL│ │   Oracle     │
     │   (built-in) │ │ (built-in)│ │ (custom)     │
     ├──────────────┤ ├───────────┤ ├─────────────┤
     │ JSON_OBJECT  │ │ jsonb     │ │ String concat│
     │ FULLTEXT     │ │ tsvector  │ │ LIKE fallback│
     │ MATCH AGAINST│ │ ts_rank   │ │ ROWNUM paging│
     │ utf8mb4      │ │ INT8 parse│ │ Thick/Thin   │
     └──────────────┘ └───────────┘ └─────────────┘
```

## Oracle Dialect (`oracle.dialect.ts` — 662 lines)

Kysely officially supports MySQL, PostgreSQL, and SQLite. The Oracle dialect was built from scratch to integrate with Kysely's plugin architecture.

### Key Components

| Component | Purpose |
|-----------|---------|
| `OracleDialect` | Main dialect class implementing Kysely's `Dialect` interface |
| `OracleDriver` | Connection management with `oracledb` library |
| `OracleIntrospector` | Schema introspection for Oracle catalog tables |
| `OracleQueryCompiler` | SQL generation with Oracle-specific syntax |
| `OracleAdapter` | Result set transformation and type mapping |

### Oracle Version Handling

```typescript
// Oracle 11g: requires Thick mode with Instant Client
if (config.version === '11g') {
  oracledb.initOracleClient({ libDir: config.instantClientPath });
}

// Oracle 12c+: uses Thin mode (no native dependencies)
// Default behavior, no initialization needed
```

### Pagination

```sql
-- MySQL/PostgreSQL:
SELECT * FROM pages LIMIT 10 OFFSET 20

-- Oracle 12c+:
SELECT * FROM pages OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY

-- Oracle 11g:
SELECT * FROM (
  SELECT t.*, ROWNUM rn FROM (
    SELECT * FROM pages ORDER BY created_at
  ) t WHERE ROWNUM <= 30
) WHERE rn > 20
```

## Query Builder (`query-builder.ts` — 375 lines)

The `QueryBuilder` provides a unified interface for database-specific operations.

### JSON Building

Different databases construct JSON objects differently:

```sql
-- MySQL:
JSON_OBJECT('id', u.user_id, 'name', u.display_name)

-- PostgreSQL:
json_build_object('id', u.user_id, 'name', u.display_name)

-- Oracle 12c+:
JSON_OBJECT('id' VALUE u.user_id, 'name' VALUE u.display_name)

-- Oracle 11g:
'{"id":"' || u.user_id || '","name":"' || u.display_name || '"}'
```

The `JsonBuilder` abstraction normalizes this:

```typescript
const json = queryBuilder.jsonObject({
  id: 'u.user_id',
  name: 'u.display_name',
});
// Produces the correct SQL for the current database
```

### Full-Text Search

```sql
-- PostgreSQL: tsvector + ts_rank
WHERE to_tsvector('simple', title) @@ plainto_tsquery('simple', ?)
ORDER BY ts_rank(to_tsvector('simple', title), plainto_tsquery('simple', ?)) DESC

-- MySQL: FULLTEXT index + MATCH AGAINST
WHERE MATCH(title, content) AGAINST(? IN BOOLEAN MODE)
ORDER BY MATCH(title, content) AGAINST(? IN BOOLEAN MODE) DESC

-- Oracle: LIKE fallback (no FTS index required)
WHERE LOWER(title) LIKE LOWER('%' || ? || '%')
   OR LOWER(content) LIKE LOWER('%' || ? || '%')
```

## Table Name Mapper (`table-name-mapper.plugin.ts` — 166 lines)

Enterprise deployments often use schema-prefixed table names. The mapper plugin intercepts Kysely queries and applies the correct schema prefix based on the database type and configuration.

```typescript
// Configuration:
DB_WIKI_SCHEMA=covi_wiki      // Wiki tables schema
DB_GW_SCHEMA=covi_smart4j     // Groupware tables schema

// Result:
'wiki_pages'       → 'covi_wiki.wiki_pages'
'sys_object_user'  → 'covi_smart4j.sys_object_user'

// Oracle uses a different default schema:
'wiki_pages'       → 'gwuser.wiki_pages'
```

## Dialect Registry (`dialects.ts`, `dialects-oracle.ts`)

The dialect is selected at startup based on the `DATABASE_URL` protocol:

```
mysql://...    → MysqlDialect (Kysely built-in)
postgres://... → PostgresDialect (Kysely built-in)
oracle://...   → OracleDialect (custom)
```

The Oracle dialect is in a separate file (`dialects-oracle.ts`) to allow tree-shaking the `oracledb` dependency when not needed.

## DB Clustering Support

For MySQL/MariaDB, the system supports multi-node clustering with round-robin load distribution:

```
Application
     │
     ▼
Round-Robin Distribution
     │
     ├──▶ Node 1 (CLUSTERING_DB_HOST_1)
     ├──▶ Node 2 (CLUSTERING_DB_HOST_2)
     └──▶ Node 3 (CLUSTERING_DB_HOST_3)

■ Node failure: auto-exclude after 5 consecutive errors
■ Recovery: health check every 30s, auto-reinstate
■ Connection pool: total pool size divided equally among nodes
```

Configuration via environment variables:
```
DB_CLUSTERING=Y
CLUSTERING_DB_HOST_1=192.168.1.1
CLUSTERING_DB_HOST_2=192.168.1.2
CLUSTERING_DB_PORT=3306
CLUSTERING_DB_USER=wikiuser
CLUSTERING_DB_NAME=covi_wiki
```
