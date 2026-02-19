# Architecture Overview

## System Architecture

The enterprise wiki system operates as an iframe-embedded application within a Java/Spring groupware platform. It consists of three independently scalable services communicating through Redis.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Browser                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              Groupware (Java/Spring, :80/443)                 │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                    CoviWiki (iframe)                     │  │  │
│  │  │              React + TipTap Editor + Yjs                │  │  │
│  │  └───────────────────────┬─────────────────────────────────┘  │  │
│  │                          │ postMessage ↕                      │  │
│  │  ┌───────────────────────┴─────────────────────────────────┐  │  │
│  │  │           Bridge Layer (coviWiki.inbound/outbound)      │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────┬────────────────────────────────┬────────────────────┘
               │ REST API (CWAT Cookie)         │ WebSocket (Yjs + Socket.IO)
               ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────────┐
│    CoviWiki API Server       │  │    Collaboration Server          │
│    (NestJS + Fastify)        │  │    (Hocuspocus + Yjs)            │
│                              │  │                                  │
│  ┌────────┐  ┌────────────┐ │  │  ┌──────────┐  ┌─────────────┐  │
│  │ GW     │  │ Core       │ │  │  │ Auth     │  │ Persistence │  │
│  │ Module │  │ Modules    │ │  │  │ Extension│  │ Extension   │  │
│  └────────┘  └────────────┘ │  │  └──────────┘  └─────────────┘  │
│  ┌────────┐  ┌────────────┐ │  │  ┌──────────┐  ┌─────────────┐  │
│  │ Auth   │  │ WebSocket  │ │  │  │ Redis    │  │ Logger      │  │
│  │ Guard  │  │ Gateway    │ │  │  │ Sync Ext │  │ Extension   │  │
│  └────────┘  └────────────┘ │  │  └──────────┘  └─────────────┘  │
└──────────────┬───────────────┘  └──────────┬──────────────────────┘
               │                              │
       ┌───────┴──────────────────────────────┴───────┐
       │                                              │
       ▼                                              ▼
┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐
│   Database   │  │    Redis     │  │     Storage (Local / S3)   │
│ MySQL / PG   │  │  Pub/Sub +   │  │                            │
│  / Oracle    │  │  Queue + WS  │  │  Attachments, Images       │
└──────────────┘  └──────────────┘  └────────────────────────────┘
```

## Deployment Model

The groupware and CoviWiki share the same domain, with path-based routing:

```
company.com/              → Groupware (Java/Spring)
company.com/coviwiki/     → CoviWiki Static Files (React SPA)
company.com/coviwiki/api/ → CoviWiki API Server (NestJS, port 3000)
company.com/coviwiki/collab/ → Collaboration Server (Hocuspocus, port 3001)
```

This eliminates cross-origin cookie issues — the `CWAT` JWT cookie is naturally shared under the same domain.

## Server Module Structure

```
AppModule
├── CoreModule
│   ├── AuthModule          # JWT auth, auto-login, token management
│   ├── UserModule          # User lookup (groupware DB integration)
│   ├── SpaceModule         # Space CRUD, member management
│   ├── PageModule          # Page CRUD, tree structure, history
│   ├── SearchModule        # DB-specific full-text search
│   └── CaslModule          # RBAC permission management
│
├── GwModule (custom)       # ← All custom groupware integration
│   ├── GwController        # Groupware-specific API endpoints
│   ├── GwService           # Business logic for GW features
│   └── FileTokenService    # HMAC-SHA256 tokens for doc viewer
│
├── CollaborationModule
│   ├── RedisSyncExtension  # ← Custom: multi-pod Yjs sync
│   ├── AuthExtension       # Connection-time JWT validation
│   └── PersistenceExtension # Yjs ↔ DB synchronization
│
├── WsModule                # Socket.IO + Redis adapter
└── DatabaseModule          # Kysely ORM (multi-DB dialects)
```

## Authentication Flow

```
User → Groupware Login → Session (X-User-Code, X-Company-Code headers)
                              │
                              ▼
                    CoviWiki /api/auth/auto-login
                              │
                              ├─ Lookup user in groupware DB (sys_object_user)
                              ├─ Create/sync wiki user record
                              ├─ Generate JWT (sub: userCode, workspaceId: companyCode)
                              └─ Set CWAT cookie (HttpOnly, 2h expiry)
                              │
                              ▼
                    Subsequent API requests include CWAT cookie
                              │
                              ├─ DomainMiddleware: extract workspaceId
                              ├─ JwtAuthGuard: validate token + load user
                              └─ SpaceAbilityFactory: CASL permission check
```

## Client Data Flow

```
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Jotai Atoms │────▶│ React Component│────▶│  TanStack Query  │
│ (client state)│    │  (UI render)   │     │ (server state)   │
└──────┬───────┘     └────────┬───────┘     └────────┬─────────┘
       │                      │                      │
       │  currentUserAtom     │  usePageQuery()      │  Axios API Client
       │  socketAtom          │  useMutations()      │
       │  pageEditorAtom      │  useTreeSocket()     │
       │                      │                      ▼
       │              ┌───────┴───────┐     ┌──────────────────┐
       └──────────────│  Socket.IO    │     │  REST API        │
                      │  (live tree)  │     │  /api/gw/*       │
                      └───────────────┘     └──────────────────┘
```

## Key Design Decisions

1. **Same-domain deployment** instead of separate origins — avoids third-party cookie restrictions and simplifies auth
2. **Separate collaboration server** — can scale independently from the API server based on concurrent editor count
3. **Redis as the universal bus** — Pub/Sub for collab sync, adapter for Socket.IO, backend for BullMQ job queues
4. **Kysely over Prisma/TypeORM** — lightweight, type-safe query builder that allows custom dialect plugins for Oracle support
5. **GwModule isolation** — all groupware-specific code in a single NestJS module, keeping the core Docmost modules unmodified for easier upstream merges
