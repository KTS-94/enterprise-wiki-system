# Enterprise Wiki System

> An enterprise collaborative wiki platform built by extending the open-source [Docmost](https://github.com/docmost/docmost) project with groupware integration, multi-database support, and horizontal scaling capabilities.

**[한국어 상세 기술 문서 (Korean Technical Portfolio)](./PORTFOLIO.md)**

---

## Highlights

This repository contains **custom code only** — the extensions and integrations I built on top of the Docmost base. It showcases enterprise-grade solutions across 30 files and ~4,600 lines of TypeScript.

### 1. Oracle Dialect for Kysely ORM
Implemented a complete Oracle dialect (662 lines) for the Kysely query builder, which officially supports only MySQL, PostgreSQL, and SQLite. Handles Oracle 11g Thick mode, `ROWNUM`-based pagination, and string-concatenation JSON building as a fallback for environments without `JSON_OBJECT`.

### 2. Multi-Pod Real-Time Collaboration via Redis
Built a custom Hocuspocus extension (442 lines) that synchronizes Yjs CRDT documents across Kubernetes pods using Redis Pub/Sub. Includes document state caching, awareness broadcasting, and loop prevention via `transactionOrigin` tracking.

### 3. iframe Bridge Protocol for Groupware Integration
Designed a bidirectional `postMessage` communication layer between the parent groupware (Java/Spring) and the wiki editor (React iframe). Handles page navigation, edit mode toggling, heading TOC sync, inline comments, and file preview delegation.

### 4. Multi-Database Query Abstraction
Created a `QueryBuilder` adapter (375 lines) that abstracts database-specific differences in JSON construction, full-text search, pagination, and schema prefixing across MySQL, PostgreSQL, and Oracle.

### 5. Clipboard Handlers for Korean Office Suites
Custom paste handlers for HWP (Hancom Office) and Excel formats. Parses non-standard clipboard MIME types and converts them into TipTap editor nodes while preserving table structure and formatting.

### 6. WebSocket Scaling with Redis Adapter
Socket.IO Redis adapter for multi-pod event broadcasting. Enables real-time page tree synchronization across horizontally scaled NestJS instances.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Browser                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │         Groupware (Java/Spring, iframe host)      │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │     CoviWiki Editor (React + TipTap + Yjs)  │  │  │
│  │  └──────────────────┬──────────────────────────┘  │  │
│  │                     │ postMessage ↕                │  │
│  │  ┌──────────────────┴──────────────────────────┐  │  │
│  │  │     Bridge Layer (inbound / outbound)        │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└────────────┬──────────────────────────┬─────────────────┘
             │ REST API                 │ WebSocket (Yjs)
             ▼                          ▼
┌────────────────────────┐  ┌─────────────────────────────┐
│   API Server (NestJS)  │  │  Collaboration Server       │
│   ├─ GW Module         │  │  (Hocuspocus + Yjs)         │
│   ├─ Auth Guard        │  │  ├─ Redis Sync Extension    │
│   ├─ Domain Middleware  │  │  ├─ Persistence Extension   │
│   └─ WebSocket Gateway │  │  └─ Auth Extension          │
└────────────┬───────────┘  └──────────┬──────────────────┘
             │                          │
     ┌───────┴──────────────────────────┴───────┐
     ▼                    ▼                      ▼
┌──────────┐    ┌──────────────┐    ┌────────────────────┐
│ Database │    │    Redis     │    │  Storage (S3/Local) │
│ MySQL/PG │    │  Pub/Sub +   │    │                    │
│ /Oracle  │    │  Queue + WS  │    │                    │
└──────────┘    └──────────────┘    └────────────────────┘
```

---

## Repository Structure

```
├── server/                          # Backend customizations (16 files, ~3,400 lines)
│   ├── gw/                          # [NEW] Groupware integration module
│   ├── database/                    # [NEW] Multi-DB support (Oracle dialect, query builder)
│   ├── collaboration/               # [NEW] Redis sync for multi-pod collab
│   ├── ws/                          # [NEW] WebSocket Redis adapter
│   ├── common/                      # [NEW] Middleware & decorators
│   └── integrations/                # [MODIFIED] Extended environment config
│
├── client/                          # Frontend customizations (12 files, ~930 lines)
│   ├── features/editor/             # [NEW] Bridge hooks, paste handlers
│   ├── hooks/                       # [NEW] GW mode detection, idle tracking
│   └── pages/                       # [NEW] GW-specific route components
│
├── packages/editor-ext/             # Shared editor extensions (2 files, ~250 lines)
│   └── comment/                     # [NEW] Inline comment marks
│
└── docs/                            # Technical documentation
    ├── architecture-overview.md
    ├── multi-db-strategy.md
    ├── realtime-collab-scaling.md
    └── iframe-bridge-protocol.md
```

---

## File Statistics

| Directory | Files | Lines | Description |
|-----------|------:|------:|-------------|
| `server/gw/` | 5 | 990 | Groupware API module, file token service |
| `server/database/` | 5 | 1,288 | Oracle dialect, query builder, table mapper |
| `server/collaboration/` | 1 | 442 | Redis Pub/Sub sync extension |
| `server/ws/` | 1 | 112 | Socket.IO Redis adapter |
| `server/common/` | 2 | 67 | Domain middleware, auth decorator |
| `server/integrations/` | 2 | 510 | Extended environment config |
| `client/features/editor/` | 4 | 740 | Bridge hooks, paste handlers |
| `client/hooks/` | 2 | 71 | GW mode, idle detection |
| `client/pages/` | 6 | 116 | GW route components |
| `packages/editor-ext/` | 2 | 252 | Inline comment extension |
| **Total** | **30** | **~4,600** | |

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Vite, TipTap/ProseMirror, Yjs, Mantine UI, Jotai, TanStack Query |
| **Backend** | NestJS 11, Fastify, Kysely ORM, Hocuspocus, Socket.IO, BullMQ |
| **Database** | MySQL/MariaDB, PostgreSQL, Oracle 11g/19c |
| **Infrastructure** | Redis (Sentinel HA), Docker, Nx Monorepo, pnpm |
| **Real-time** | Yjs CRDT, Hocuspocus WebSocket, Redis Pub/Sub |
| **Auth** | JWT (cookie-based), CASL RBAC, HMAC-SHA256 file tokens |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Overview](./docs/architecture-overview.md) | System architecture, module structure, data flow |
| [Multi-DB Strategy](./docs/multi-db-strategy.md) | Oracle dialect design, query abstraction, schema mapping |
| [Real-Time Collab Scaling](./docs/realtime-collab-scaling.md) | Redis sync protocol, multi-pod coordination |
| [iframe Bridge Protocol](./docs/iframe-bridge-protocol.md) | postMessage protocol spec, message types |

---

## Context

This project was developed as a solo full-stack engineer responsible for architecture, implementation, and deployment. The base Docmost project (AGPL-3.0) provided the core wiki engine — editor, page management, and collaboration framework. All code in this repository represents custom extensions built for enterprise groupware integration.

Key challenges solved:
- Integrating a modern Node.js wiki into a legacy Java/Spring enterprise groupware via iframe
- Supporting Oracle 11g alongside MySQL/PostgreSQL with a single codebase
- Scaling real-time collaboration across Kubernetes pods
- Handling Korean enterprise-specific formats (HWP, Excel clipboard)

---

## License

Custom code in this repository is licensed under [MIT](./LICENSE).

The base project [Docmost](https://github.com/docmost/docmost) is licensed under AGPL-3.0.
