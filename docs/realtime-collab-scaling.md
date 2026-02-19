# 실시간 협업 확장

## 문제

Kubernetes 멀티 Pod 배포 환경에서 각 Hocuspocus 협업 서버 인스턴스는 자체 인메모리 Yjs 문서 상태를 관리합니다. 서로 다른 Pod에 연결된 사용자들은 Yjs 문서가 격리되어 있어 상대방의 편집 내용을 볼 수 없습니다.

```
Pod 1 (Hocuspocus)          Pod 2 (Hocuspocus)
┌─────────────────┐         ┌─────────────────┐
│ 사용자 A 편집중  │         │ 사용자 B 편집중  │
│ 문서: "Hello"   │   ✗     │ 문서: "Hello"   │
│                 │ ←────→  │                 │
│ Yjs 상태: X     │         │ Yjs 상태: Y     │
└─────────────────┘         └─────────────────┘
    상태가 분기됨 — 편집 내용 유실
```

## 해결: Redis Sync Extension

`RedisSyncExtension`(442줄)은 Redis Pub/Sub를 사용하여 Pod 간 Yjs 문서 상태를 동기화하는 커스텀 Hocuspocus 확장입니다.

```
Pod 1 (Hocuspocus)          Redis Pub/Sub             Pod 2 (Hocuspocus)
       │                         │                          │
       │── Yjs Update ──────▶  발행  ────────────────▶    │
       │   (coviwiki:yjs:updates)                          │
       │                                                    │
       │◀── Awareness 동기화 ── 구독 ◀──────────────────  │
       │   (coviwiki:yjs:awareness)                        │
       │                                                    │
       │   문서 상태 Redis에 캐시 (TTL: 1시간)              │
```

## 아키텍처

### Redis 채널

| 채널 | 용도 |
|------|------|
| `coviwiki:yjs:updates` | Yjs 문서 업데이트 델타 |
| `coviwiki:yjs:awareness` | 사용자 커서 위치, 접속 상태 |

### Redis 키

| 키 패턴 | 용도 | TTL |
|---------|------|-----|
| `coviwiki:doc:{documentName}` | 캐시된 Yjs 문서 상태 | 설정 가능 (기본: 1시간) |

### Extension 라이프사이클

```
1. onConfigure()
   ├─ Redis pub/sub 연결 생성
   ├─ 업데이트 + awareness 채널 구독
   └─ 이 Pod 인스턴스의 고유 nodeId 생성

2. onLoadDocument(documentName)
   ├─ Redis 캐시에서 기존 문서 상태 확인
   ├─ 있으면: 캐시된 상태를 Yjs 문서에 적용 (빠른 복원)
   └─ 없으면: DB에서 로드 (PersistenceExtension 경유)

3. onChange(documentName, update)
   ├─ 업데이트를 Redis 채널에 발행
   │   페이로드: { nodeId, documentName, update (base64) }
   └─ 문서 상태를 Redis 캐시에 저장 (TTL 적용)

4. onAwarenessUpdate(documentName, awareness)
   └─ Awareness 델타를 Redis 채널에 발행
       페이로드: { nodeId, documentName, clients, update (base64) }

5. afterUnloadDocument(documentName)
   └─ 언로드된 문서의 Redis 캐시 정리
```

## 루프 방지

안전장치 없이는 Pod이 Redis에서 자신이 발행한 업데이트를 다시 수신하여 적용하면서 무한 루프가 발생합니다.

```
Pod 1이 업데이트 발행
    ↓
Redis가 모든 구독자에게 브로드캐스트 (Pod 1 포함)
    ↓
Pod 1이 자신의 업데이트를 수신 ← 반드시 무시해야 함
```

### 해결: `nodeId` + `transactionOrigin`

각 Pod는 시작 시 고유한 `nodeId`를 생성합니다 (`crypto.randomUUID()` 사용). 발행 시:

```typescript
// 발행
redis.publish(channel, JSON.stringify({
  nodeId: this.nodeId,   // 발신자 식별
  documentName,
  update: base64Update,
}));
```

수신 시:

```typescript
// 구독
if (message.nodeId === this.nodeId) return; // 자신의 메시지 무시

// transactionOrigin을 지정하여 재발행 방지
Y.applyUpdate(doc, update, `redis-sync-${message.nodeId}`);
```

`onChange` 핸들러에서도 `transactionOrigin`을 확인합니다:

```typescript
onChange({ transactionOrigin }) {
  if (typeof transactionOrigin === 'string'
      && transactionOrigin.startsWith('redis-sync-')) {
    return; // Redis에서 수신한 업데이트는 재발행하지 않음
  }
  // Redis에 발행...
}
```

## 문서 상태 캐싱

새 Pod이 시작되거나 특정 Pod에서 문서가 처음 열릴 때 현재 문서 상태가 필요합니다. 다음 DB 로드 주기를 기다리지 않고, 확장이 먼저 Redis를 확인합니다:

```
새 Pod이 "page-123" 문서를 열 때
    │
    ├─ Redis 확인: GET coviwiki:doc:page-123
    │
    ├─ 캐시 HIT:  캐시된 Yjs 상태 적용 (빠름, ~5ms)
    │
    └─ 캐시 MISS: PersistenceExtension을 통해 DB에서 로드 (~50ms)
```

캐시는 문서가 변경될 때마다 갱신되며, 설정 가능한 TTL(`COLLAB_DOC_TTL`, 기본 3600초)이 적용됩니다.

## Awareness (커서/접속 상태) 동기화

사용자 접속 상태(커서 위치, 선택 범위, 사용자 정보)는 문서 콘텐츠와 별도로 동기화됩니다:

```
사용자 A가 Pod 1에서 커서 이동
    │
    ▼
Awareness 프로토콜이 델타 인코딩
    │
    ▼
coviwiki:yjs:awareness 채널에 발행
    │
    ▼
Pod 2가 수신, 로컬 awareness에 적용
    │
    ▼
사용자 B가 사용자 A의 커서 위치를 확인
```

Redis 메시지 볼륨을 줄이기 위해 Awareness 하트비트를 10초 간격으로 쓰로틀링합니다. 클라이언트 측 유휴 감지(`use-idle.ts`)가 5분간 비활성 탭의 연결을 끊어 불필요한 Awareness 트래픽을 추가로 줄입니다.

## WebSocket 게이트웨이 (`ws-redis.adapter.ts` — 112줄)

협업 동기화 외에도, Socket.IO WebSocket 게이트웨이 역시 Redis를 사용하여 Pod 간 이벤트를 브로드캐스팅합니다. 어느 Pod에 연결되어 있든 모든 클라이언트에게 실시간 페이지 트리 업데이트(생성, 이동, 삭제)를 전달합니다.

```typescript
// Socket.IO Redis 어댑터 설정
const pubClient = createRedisClient(redisConfig);
const subClient = pubClient.duplicate();
server.adapter(createAdapter(pubClient, subClient));
```

## 성능 결과

- 최대 5개 Pod, 100명 이상 동시 편집 환경에서 테스트 완료
- Awareness 쓰로틀링으로 Redis 메시지 볼륨 90% 감소
- Redis 캐시에서 문서 상태 복원: ~5ms (DB 대비 ~50ms)
- Pod 재시작 시 데이터 유실 없음 (Redis 캐시 + DB 영속화)
