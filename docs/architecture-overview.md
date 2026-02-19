# 아키텍처 개요

## 시스템 아키텍처

엔터프라이즈 위키 시스템은 Java/Spring 그룹웨어 플랫폼 내에 iframe으로 임베딩되어 동작합니다. Redis를 통해 통신하는 3개의 독립적으로 확장 가능한 서비스로 구성됩니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        사용자 브라우저                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              그룹웨어 (Java/Spring, :80/443)                   │  │
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
               │ REST API (CWAT 쿠키)           │ WebSocket (Yjs + Socket.IO)
               ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────────┐
│    CoviWiki API 서버          │  │    협업 서버                      │
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
│  / Oracle    │  │  Queue + WS  │  │  첨부파일, 이미지            │
└──────────────┘  └──────────────┘  └────────────────────────────┘
```

## 배포 모델

그룹웨어와 CoviWiki는 동일 도메인을 공유하며, 경로 기반 라우팅을 사용합니다:

```
company.com/              → 그룹웨어 (Java/Spring)
company.com/coviwiki/     → CoviWiki 정적 파일 (React SPA)
company.com/coviwiki/api/ → CoviWiki API 서버 (NestJS, port 3000)
company.com/coviwiki/collab/ → 협업 서버 (Hocuspocus, port 3001)
```

이를 통해 Cross-Origin 쿠키 문제를 원천 차단합니다. `CWAT` JWT 쿠키는 동일 도메인이므로 자연스럽게 공유됩니다.

## 서버 모듈 구조

```
AppModule
├── CoreModule
│   ├── AuthModule          # JWT 인증, 자동 로그인, 토큰 관리
│   ├── UserModule          # 사용자 조회 (그룹웨어 DB 연동)
│   ├── SpaceModule         # 스페이스 CRUD, 멤버 관리
│   ├── PageModule          # 페이지 CRUD, 트리 구조, 히스토리
│   ├── SearchModule        # DB별 전문 검색 (FTS)
│   └── CaslModule          # RBAC 권한 관리
│
├── GwModule (커스텀)       # ← 그룹웨어 통합 전체
│   ├── GwController        # 그룹웨어 전용 API 엔드포인트
│   ├── GwService           # GW 기능 비즈니스 로직
│   └── FileTokenService    # 문서 뷰어용 HMAC-SHA256 토큰
│
├── CollaborationModule
│   ├── RedisSyncExtension  # ← 커스텀: 멀티 Pod Yjs 동기화
│   ├── AuthExtension       # 연결 시 JWT 검증
│   └── PersistenceExtension # Yjs ↔ DB 동기화
│
├── WsModule                # Socket.IO + Redis 어댑터
└── DatabaseModule          # Kysely ORM (멀티 DB Dialect)
```

## 인증 흐름

```
사용자 → 그룹웨어 로그인 → 세션 생성 (X-User-Code, X-Company-Code 헤더)
                              │
                              ▼
                    CoviWiki /api/auth/auto-login
                              │
                              ├─ 그룹웨어 DB에서 사용자 조회 (sys_object_user)
                              ├─ 위키 사용자 레코드 생성/동기화
                              ├─ JWT 생성 (sub: userCode, workspaceId: companyCode)
                              └─ CWAT 쿠키 설정 (HttpOnly, 2시간 만료)
                              │
                              ▼
                    이후 API 요청에 CWAT 쿠키 자동 포함
                              │
                              ├─ DomainMiddleware: workspaceId 추출
                              ├─ JwtAuthGuard: 토큰 검증 + 사용자 로드
                              └─ SpaceAbilityFactory: CASL 권한 체크
```

## 클라이언트 데이터 흐름

```
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Jotai Atom  │────▶│ React 컴포넌트  │────▶│  TanStack Query  │
│ (클라이언트   │     │  (UI 렌더링)    │     │  (서버 상태)      │
│    상태)      │     └────────┬───────┘     └────────┬─────────┘
└──────┬───────┘              │                      │
       │                      │                      │
       │  currentUserAtom     │  usePageQuery()      │  Axios API Client
       │  socketAtom          │  useMutations()      │
       │  pageEditorAtom      │  useTreeSocket()     │
       │                      │                      ▼
       │              ┌───────┴───────┐     ┌──────────────────┐
       └──────────────│  Socket.IO    │     │  REST API        │
                      │ (실시간 트리)  │     │  /api/gw/*       │
                      └───────────────┘     └──────────────────┘
```

## 핵심 설계 결정

1. **동일 도메인 배포** — 별도 오리진 대신 같은 도메인 하위 경로 사용. 서드파티 쿠키 제한 회피 및 인증 단순화
2. **협업 서버 분리** — 동시 편집자 수에 따라 API 서버와 독립적으로 스케일링 가능
3. **Redis를 범용 버스로 활용** — 협업 동기화(Pub/Sub), Socket.IO 어댑터, BullMQ 작업 큐 백엔드 등 다목적 사용
4. **Prisma/TypeORM 대신 Kysely** — 경량 타입 안전 쿼리 빌더로 Oracle 지원을 위한 커스텀 Dialect 플러그인 구현 가능
5. **GwModule 격리** — 그룹웨어 전용 코드를 단일 NestJS 모듈로 분리. 코어 Docmost 모듈을 수정하지 않아 업스트림 머지 용이
