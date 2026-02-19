# Real-Time Collaboration Scaling

## Problem

In a Kubernetes deployment with multiple pods, each Hocuspocus collaboration server instance maintains its own in-memory Yjs document state. Users connected to different pods cannot see each other's edits because their Yjs documents are isolated.

```
Pod 1 (Hocuspocus)          Pod 2 (Hocuspocus)
┌─────────────────┐         ┌─────────────────┐
│ User A editing  │         │ User B editing  │
│ Doc: "Hello"    │   ✗     │ Doc: "Hello"    │
│                 │ ←────→  │                 │
│ Yjs state: X    │         │ Yjs state: Y    │
└─────────────────┘         └─────────────────┘
    States diverge — edits are lost
```

## Solution: Redis Sync Extension

`RedisSyncExtension` (442 lines) is a custom Hocuspocus extension that synchronizes Yjs document state across pods using Redis Pub/Sub.

```
Pod 1 (Hocuspocus)          Redis Pub/Sub             Pod 2 (Hocuspocus)
       │                         │                          │
       │── Yjs Update ──────▶  Publish  ──────────────▶   │
       │   (coviwiki:yjs:updates)                          │
       │                                                    │
       │◀── Awareness Sync ── Subscribe ◀──────────────── │
       │   (coviwiki:yjs:awareness)                        │
       │                                                    │
       │   Doc state cached in Redis (TTL: 1 hour)         │
```

## Architecture

### Redis Channels

| Channel | Purpose |
|---------|---------|
| `coviwiki:yjs:updates` | Yjs document update deltas |
| `coviwiki:yjs:awareness` | User cursor positions, presence |

### Redis Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `coviwiki:doc:{documentName}` | Cached Yjs document state | Configurable (default: 1h) |

### Extension Lifecycle

```
1. onConfigure()
   ├─ Create Redis pub/sub connections
   ├─ Subscribe to update + awareness channels
   └─ Generate unique nodeId for this pod instance

2. onLoadDocument(documentName)
   ├─ Check Redis cache for existing document state
   ├─ If found: apply cached state to Yjs doc (fast restore)
   └─ If not: fall back to database load (via PersistenceExtension)

3. onChange(documentName, update)
   ├─ Publish update to Redis channel
   │   Payload: { nodeId, documentName, update (base64) }
   └─ Save document state to Redis cache (with TTL)

4. onAwarenessUpdate(documentName, awareness)
   └─ Publish awareness delta to Redis channel
       Payload: { nodeId, documentName, clients, update (base64) }

5. afterUnloadDocument(documentName)
   └─ Clean up Redis cache for unloaded document
```

## Loop Prevention

Without safeguards, a pod would receive its own published updates from Redis and apply them again, creating an infinite loop.

```
Pod 1 publishes update
    ↓
Redis broadcasts to all subscribers (including Pod 1)
    ↓
Pod 1 receives its own update ← MUST IGNORE
```

### Solution: `nodeId` + `transactionOrigin`

Each pod generates a unique `nodeId` at startup (using `crypto.randomUUID()`). When publishing:

```typescript
// Publishing
redis.publish(channel, JSON.stringify({
  nodeId: this.nodeId,   // sender identification
  documentName,
  update: base64Update,
}));
```

When receiving:

```typescript
// Subscribing
if (message.nodeId === this.nodeId) return; // Skip own messages

// Apply with transactionOrigin to prevent re-publishing
Y.applyUpdate(doc, update, `redis-sync-${message.nodeId}`);
```

The `onChange` handler also checks `transactionOrigin`:

```typescript
onChange({ transactionOrigin }) {
  if (typeof transactionOrigin === 'string'
      && transactionOrigin.startsWith('redis-sync-')) {
    return; // Don't re-publish updates received from Redis
  }
  // Publish to Redis...
}
```

## Document State Caching

When a new pod starts or a document is opened for the first time on a pod, it needs the current document state. Rather than waiting for the next database load cycle, the extension checks Redis first:

```
New Pod opens document "page-123"
    │
    ├─ Check Redis: GET coviwiki:doc:page-123
    │
    ├─ Cache HIT:  Apply cached Yjs state (fast, ~5ms)
    │
    └─ Cache MISS: Load from database via PersistenceExtension (~50ms)
```

The cache is updated on every document change with a configurable TTL (`COLLAB_DOC_TTL`, default 3600 seconds).

## Awareness (Cursor/Presence) Sync

User presence (cursor positions, selection ranges, user info) is synchronized separately from document content:

```
User A moves cursor in Pod 1
    │
    ▼
Awareness protocol encodes delta
    │
    ▼
Publish to coviwiki:yjs:awareness
    │
    ▼
Pod 2 receives, applies to local awareness
    │
    ▼
User B sees User A's cursor position
```

Awareness heartbeats are throttled to 10-second intervals to reduce Redis message volume. Client-side idle detection (`use-idle.ts`) disconnects inactive tabs after 5 minutes, further reducing unnecessary awareness traffic.

## WebSocket Gateway (`ws-redis.adapter.ts` — 112 lines)

In addition to collaboration sync, the Socket.IO WebSocket gateway also uses Redis for cross-pod event broadcasting. This handles real-time page tree updates (create, move, delete) across all connected clients regardless of which pod they're connected to.

```typescript
// Socket.IO Redis adapter setup
const pubClient = createRedisClient(redisConfig);
const subClient = pubClient.duplicate();
server.adapter(createAdapter(pubClient, subClient));
```

## Performance Results

- Tested with up to 5 pods, 100+ concurrent editors
- Redis message volume reduced 90% via awareness throttling
- Document state restoration from Redis cache: ~5ms (vs ~50ms from DB)
- Zero data loss during pod restarts (Redis cache + DB persistence)
