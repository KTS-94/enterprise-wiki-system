# Server — Custom Backend Code

Custom NestJS backend modules built on top of Docmost's server architecture.

## Directory Overview

### `gw/` — Groupware Integration Module [NEW]

The core integration layer between the enterprise groupware (Java/Spring) and CoviWiki.

| File | Lines | Description |
|------|------:|-------------|
| `gw.module.ts` | 17 | NestJS module definition |
| `gw.controller.ts` | 317 | REST API endpoints for groupware operations (page list, space management, approval workflow, notifications) |
| `file-token.service.ts` | 117 | HMAC-SHA256 token generation/validation for Synap document viewer integration |
| `page/dto/gw-page.dto.ts` | 40 | DTOs for groupware page operations |
| `page/services/gw.service.ts` | 499 | Business logic — page CRUD via groupware DB, user sync, share/approval features |

### `database/` — Multi-Database Support [NEW]

Custom database layer enabling Oracle support alongside MySQL and PostgreSQL.

| File | Lines | Description |
|------|------:|-------------|
| `dialects/oracle.dialect.ts` | 662 | Complete Kysely Oracle dialect — driver, compiler, introspector, adapter. Supports 11g (Thick) and 12c+ (Thin) modes |
| `plugins/table-name-mapper.plugin.ts` | 166 | Kysely plugin that applies schema prefixes to table names (e.g., `covi_wiki.wiki_pages`) |
| `repos/dialects.ts` | 23 | Dialect registry — selects dialect based on `DATABASE_URL` protocol |
| `repos/dialects-oracle.ts` | 62 | Oracle-specific dialect initialization (separate for tree-shaking) |
| `repos/query-builder.ts` | 375 | Unified query abstraction — JSON building, full-text search, pagination across all three databases |

### `collaboration/` — Real-Time Collaboration [NEW]

| File | Lines | Description |
|------|------:|-------------|
| `extensions/redis-sync.extension.ts` | 442 | Hocuspocus extension for multi-pod Yjs synchronization via Redis Pub/Sub. Handles document state caching, awareness broadcasting, and loop prevention |

### `ws/` — WebSocket Gateway [NEW]

| File | Lines | Description |
|------|------:|-------------|
| `adapter/ws-redis.adapter.ts` | 112 | Socket.IO Redis adapter for cross-pod event broadcasting (page tree real-time sync) |

### `common/` — Middleware & Decorators [NEW]

| File | Lines | Description |
|------|------:|-------------|
| `middlewares/domain.middleware.ts` | 45 | Extracts workspace ID from JWT for multi-tenant request scoping |
| `decorators/auth-company-code.decorator.ts` | 22 | Parameter decorator to extract company code from the authenticated user context |

### `integrations/` — Environment Configuration [MODIFIED]

| File | Lines | Description |
|------|------:|-------------|
| `environment/environment.service.ts` | 359 | Extended with ~180 lines: Redis Sentinel, DB clustering, schema config, Oracle paths, debug controls, collab TTL |
| `environment/environment.validation.ts` | 151 | Extended with ~30 lines: Oracle protocol validation, clustering env vars, schema fields |

## Total: 16 files, ~3,400 lines
