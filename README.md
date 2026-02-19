# Enterprise Wiki System

> 오픈소스 위키 [Docmost](https://github.com/docmost/docmost)를 Fork하여 엔터프라이즈 그룹웨어에 통합한 실시간 협업 위키 플랫폼

**[상세 기술 포트폴리오 문서](./PORTFOLIO.md)** — 아키텍처, 트러블슈팅, 성능 개선, 회고 등

---

## 기술 하이라이트

이 레포지토리는 Docmost 원본 위에 직접 구현한 **커스텀 코드만** 포함합니다.
30개 파일, ~4,600줄의 TypeScript로 엔터프라이즈 환경에 필요한 기능을 구현했습니다.

### 1. Kysely ORM용 Oracle Dialect 구현
Kysely는 공식적으로 MySQL, PostgreSQL, SQLite만 지원합니다. Oracle Dialect를 직접 구현(662줄)하여 Oracle 11g Thick 모드, `ROWNUM` 기반 페이징, `JSON_OBJECT` 미지원 환경을 위한 문자열 연결 JSON 빌드를 처리합니다.

### 2. Redis 기반 멀티 Pod 실시간 협업 동기화
Kubernetes 멀티 Pod 환경에서 Yjs CRDT 문서를 Redis Pub/Sub로 동기화하는 Hocuspocus 커스텀 확장(442줄)을 개발했습니다. 문서 상태 캐싱, Awareness 브로드캐스팅, `transactionOrigin` 기반 루프 방지를 포함합니다.

### 3. iframe 브릿지 프로토콜
그룹웨어(Java/Spring) 부모 창과 위키 에디터(React iframe) 간 양방향 `postMessage` 통신 레이어를 설계했습니다. 페이지 네비게이션, 편집 모드 전환, 목차 동기화, 인라인 댓글, 파일 미리보기 위임 등을 처리합니다.

### 4. 멀티 DB 쿼리 추상화
MySQL, PostgreSQL, Oracle 간 JSON 생성, 전문 검색, 페이징, 스키마 프리픽싱 차이를 추상화하는 `QueryBuilder` 어댑터(375줄)를 구현했습니다.

### 5. 한컴/Excel 클립보드 핸들러
HWP(한컴오피스)와 Excel 붙여넣기를 위한 커스텀 Paste Handler를 개발했습니다. 비표준 클립보드 MIME 타입을 파싱하여 테이블 구조와 서식을 유지한 채 TipTap 에디터 노드로 변환합니다.

### 6. WebSocket Redis 어댑터
멀티 Pod 간 이벤트 브로드캐스팅을 위한 Socket.IO Redis 어댑터를 구성하여 수평 확장된 NestJS 인스턴스 간 실시간 페이지 트리 동기화를 구현했습니다.

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                      사용자 브라우저                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │       그룹웨어 (Java/Spring, iframe 호스트)        │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │   CoviWiki 에디터 (React + TipTap + Yjs)    │  │  │
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
│   API 서버 (NestJS)    │  │  협업 서버                    │
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

## 레포지토리 구조

```
├── server/                          # 백엔드 커스텀 코드 (16개 파일, ~3,400줄)
│   ├── gw/                          # [NEW] 그룹웨어 통합 모듈
│   ├── database/                    # [NEW] 멀티 DB 지원 (Oracle Dialect, QueryBuilder)
│   ├── collaboration/               # [NEW] 멀티 Pod 협업 Redis 동기화
│   ├── ws/                          # [NEW] WebSocket Redis 어댑터
│   ├── common/                      # [NEW] 미들웨어, 데코레이터
│   └── integrations/                # [MODIFIED] 환경 설정 확장
│
├── client/                          # 프론트엔드 커스텀 코드 (12개 파일, ~930줄)
│   ├── features/editor/             # [NEW] 브릿지 훅, 붙여넣기 핸들러
│   ├── hooks/                       # [NEW] GW 모드 감지, 유휴 감지
│   └── pages/                       # [NEW] GW 전용 라우트 컴포넌트
│
├── packages/editor-ext/             # 공유 에디터 확장 (2개 파일, ~250줄)
│   └── comment/                     # [NEW] 인라인 댓글 마크
│
└── docs/                            # 기술 문서
    ├── architecture-overview.md     # 시스템 아키텍처
    ├── multi-db-strategy.md         # 멀티 DB 설계
    ├── realtime-collab-scaling.md   # 실시간 협업 확장
    └── iframe-bridge-protocol.md    # iframe 통신 프로토콜
```

---

## 파일 통계

| 디렉토리 | 파일 수 | 라인 수 | 설명 |
|----------|-------:|-------:|------|
| `server/gw/` | 5 | 990 | 그룹웨어 API 모듈, 파일 토큰 서비스 |
| `server/database/` | 5 | 1,288 | Oracle Dialect, QueryBuilder, 테이블 매퍼 |
| `server/collaboration/` | 1 | 442 | Redis Pub/Sub 동기화 확장 |
| `server/ws/` | 1 | 112 | Socket.IO Redis 어댑터 |
| `server/common/` | 2 | 67 | 도메인 미들웨어, 인증 데코레이터 |
| `server/integrations/` | 2 | 510 | 환경 설정 확장 (클러스터링, 스키마 등) |
| `client/features/editor/` | 4 | 740 | 브릿지 훅, 붙여넣기 핸들러 |
| `client/hooks/` | 2 | 71 | GW 모드, 유휴 감지 |
| `client/pages/` | 6 | 116 | GW 라우트 컴포넌트 |
| `packages/editor-ext/` | 2 | 252 | 인라인 댓글 확장 |
| **합계** | **30** | **~4,600** | |

---

## 기술 스택

| 계층 | 기술 |
|------|------|
| **프론트엔드** | React 18, TypeScript, Vite, TipTap/ProseMirror, Yjs, Mantine UI, Jotai, TanStack Query |
| **백엔드** | NestJS 11, Fastify, Kysely ORM, Hocuspocus, Socket.IO, BullMQ |
| **데이터베이스** | MySQL/MariaDB, PostgreSQL, Oracle 11g/19c |
| **인프라** | Redis (Sentinel HA), Docker, Nx Monorepo, pnpm |
| **실시간** | Yjs CRDT, Hocuspocus WebSocket, Redis Pub/Sub |
| **인증** | JWT (쿠키 기반), CASL RBAC, HMAC-SHA256 파일 토큰 |

---

## 기술 문서

| 문서 | 설명 |
|------|------|
| [Architecture Overview](./docs/architecture-overview.md) | 시스템 아키텍처, 모듈 구조, 데이터 흐름 |
| [Multi-DB Strategy](./docs/multi-db-strategy.md) | Oracle Dialect 설계, 쿼리 추상화, 스키마 매핑 |
| [Real-Time Collab Scaling](./docs/realtime-collab-scaling.md) | Redis 동기화 프로토콜, 멀티 Pod 조율 |
| [iframe Bridge Protocol](./docs/iframe-bridge-protocol.md) | postMessage 프로토콜 명세, 메시지 타입 |

---

## 프로젝트 배경

풀스택 개발자로서 아키텍처 설계, 구현, 배포를 담당했습니다. 베이스 프로젝트인 Docmost(AGPL-3.0)가 위키 엔진의 핵심(에디터, 페이지 관리, 협업 프레임워크)을 제공했으며, 이 레포지토리의 모든 코드는 엔터프라이즈 그룹웨어 통합을 위해 직접 구현한 커스텀 확장입니다.

**해결한 주요 과제:**
- 레거시 Java/Spring 그룹웨어에 모던 Node.js 위키를 iframe으로 통합
- 단일 코드베이스로 Oracle 11g, MySQL, PostgreSQL 동시 지원
- Kubernetes 멀티 Pod 환경에서 실시간 협업 확장
- HWP, Excel 등 한국 기업 환경 특수 포맷 처리

---

## 라이선스

이 레포지토리의 커스텀 코드는 [MIT](./LICENSE) 라이선스입니다.

베이스 프로젝트 [Docmost](https://github.com/docmost/docmost)는 AGPL-3.0 라이선스입니다.
