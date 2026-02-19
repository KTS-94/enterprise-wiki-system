# CoviWiki - Enterprise Collaborative Wiki Platform

> 오픈소스 위키(Docmost)를 기반으로 엔터프라이즈 그룹웨어에 통합한 실시간 협업 위키 플랫폼

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [아키텍처](#2-아키텍처)
3. [주요 기능](#3-주요-기능)
4. [기술 스택 및 선택 이유](#4-기술-스택-및-선택-이유)
5. [트러블슈팅 경험](#5-트러블슈팅-경험)
6. [성능 개선 사례](#6-성능-개선-사례)
7. [회고](#7-회고)

---

## 1. 프로젝트 개요

### 배경

기존 그룹웨어(SMARTS4J)에는 간단한 게시판 형태의 위키만 존재했으며, 실시간 협업 편집, 리치 텍스트 에디터, 버전 관리 등 현대적인 위키 기능이 부재했습니다. 이를 해결하기 위해 오픈소스 위키 소프트웨어인 **Docmost**를 Fork하여 엔터프라이즈 환경에 맞게 확장한 **CoviWiki**를 개발했습니다.

### 핵심 목표

- **그룹웨어 통합**: 기존 엔터프라이즈 그룹웨어의 iframe 내에서 원활하게 동작
- **실시간 협업**: 여러 사용자가 동시에 문서를 편집할 수 있는 CRDT 기반 실시간 동기화
- **멀티 DB 지원**: MySQL, PostgreSQL, Oracle 등 고객사 환경에 따른 유연한 DB 지원
- **수평 확장**: Kubernetes 환경에서의 다중 Pod 배포를 고려한 설계
- **다국어 지원**: 한국어, 영어, 일본어, 중국어 4개 언어 지원

### 담당 역할

- 1인 개발 (프론트엔드 + 백엔드 + 인프라)
- Docmost 오픈소스 분석 및 Fork
- 그룹웨어 통합 아키텍처 설계 및 구현
- 멀티 DB 지원 (Oracle Dialect 직접 구현)
- 실시간 협업 서버 Redis 동기화 확장
- CI/CD 파이프라인 및 Docker 배포 구성

---

## 2. 아키텍처

### 2.1 전체 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                        사용자 브라우저                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              그룹웨어 (SMARTS4J - Java/Spring)                │  │
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
│  / Oracle    │  │  Queue +     │  │  첨부파일, 이미지, 다이어그램  │
│              │  │  WebSocket   │  │                            │
└──────────────┘  └──────────────┘  └────────────────────────────┘
```

### 2.2 모노레포 구조

```
CoviWiki/
├── apps/
│   ├── client/                 # React 프론트엔드 (Vite)
│   │   ├── src/
│   │   │   ├── features/       # 기능별 모듈 (editor, page, space, auth...)
│   │   │   ├── components/     # 공통 UI 컴포넌트
│   │   │   ├── hooks/          # 커스텀 React 훅
│   │   │   └── lib/            # 유틸리티, API 클라이언트
│   │   └── public/locales/     # 다국어 번역 파일 (ko, en, ja, zh)
│   │
│   └── server/                 # NestJS 백엔드 (Fastify)
│       └── src/
│           ├── core/           # 도메인 모듈 (auth, user, space, page, search...)
│           ├── gw/             # 그룹웨어 통합 모듈 (커스텀)
│           ├── database/       # Kysely ORM, Repository 패턴
│           ├── collaboration/  # Hocuspocus 실시간 협업 서버
│           ├── ws/             # Socket.IO WebSocket 게이트웨이
│           ├── integrations/   # 스토리지, 큐, 내보내기, 검색
│           └── common/         # 미들웨어, 가드, 인터셉터, 필터
│
├── packages/
│   └── editor-ext/             # 공유 TipTap 에디터 확장 (서버/클라이언트 공용)
│
├── Dockerfile                  # 멀티 스테이지 빌드
├── docker-compose.yml          # 개발/배포 환경
└── nx.json                     # Nx 빌드 오케스트레이션
```

### 2.3 서버 모듈 아키텍처

```
AppModule
├── CoreModule
│   ├── AuthModule          # JWT 인증, 자동 로그인, 토큰 관리
│   ├── UserModule          # 사용자 조회 (그룹웨어 DB 연동)
│   ├── SpaceModule         # 스페이스 CRUD, 멤버 관리
│   ├── PageModule          # 페이지 CRUD, 트리 구조, 히스토리
│   ├── TemplateModule      # 템플릿 관리
│   ├── AttachmentModule    # 첨부파일 업로드/다운로드
│   ├── SearchModule        # DB별 전문 검색 (FTS)
│   └── CaslModule          # RBAC 권한 관리 (CASL)
│
├── GwModule (커스텀)
│   ├── GwController        # 그룹웨어 전용 API 엔드포인트
│   ├── GwService           # 그룹웨어 비즈니스 로직
│   └── FileTokenService    # Synap 문서 뷰어 토큰
│
├── CollaborationModule
│   ├── AuthExtension       # 협업 연결 시 JWT 검증
│   ├── PersistenceExtension # Yjs ↔ DB 동기화
│   ├── RedisSyncExtension  # 멀티 Pod 간 Yjs 상태 공유
│   └── HistoryListener     # 편집 히스토리 자동 기록
│
├── WsModule                # Socket.IO + Redis 어댑터
├── DatabaseModule          # Kysely ORM (멀티 DB)
├── QueueModule             # BullMQ 비동기 작업
├── StorageModule           # Local / S3 스토리지
└── IntegrationModules      # Health, Export, Import, Security
```

### 2.4 클라이언트 데이터 흐름

```
┌──────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Jotai Atom  │────▶│  React 컴포넌트 │────▶│  TanStack Query  │
│  (전역 상태)  │     │  (UI 렌더링)    │     │  (서버 상태)      │
└──────┬───────┘     └────────┬───────┘     └────────┬─────────┘
       │                      │                      │
       │  currentUserAtom     │  usePageQuery()      │  API Client
       │  socketAtom          │  useCreatePageMutation│  (Axios)
       │  pageEditorAtom      │  useTreeSocket()     │
       │  treeDataAtom        │                      │
       │                      │                      ▼
       │              ┌───────┴───────┐     ┌──────────────────┐
       └──────────────│  Socket.IO    │     │  REST API        │
                      │  (실시간 트리) │     │  /api/gw/*       │
                      └───────────────┘     └──────────────────┘
```

---

## 3. 주요 기능

### 3.1 실시간 협업 편집

| 항목 | 설명 |
|------|------|
| **CRDT 엔진** | Yjs 기반 Conflict-Free Replicated Data Type으로 충돌 없는 동시 편집 |
| **서버** | Hocuspocus WebSocket 서버로 문서 상태 중계 및 영속화 |
| **커서 공유** | Awareness 프로토콜로 다른 사용자의 실시간 커서 위치 표시 |
| **오프라인 지원** | IndexedDB에 로컬 캐시, 온라인 복귀 시 자동 동기화 |
| **디바운스 저장** | 10~45초 윈도우로 DB 저장 최적화 (편집 중 과도한 DB 쓰기 방지) |

### 3.2 리치 텍스트 에디터 (TipTap 기반)

```
┌─────────────────────────────────────────────────────────┐
│  슬래시 명령어 (/)  │  버블 메뉴  │  드래그 앤 드롭     │
├─────────────────────┴─────────────┴─────────────────────┤
│                                                         │
│  ■ 기본 서식: Bold, Italic, 밑줄, 취소선, 형광펜         │
│  ■ 블록: 제목(1-6), 인용, 코드블록, 콜아웃              │
│  ■ 리스트: 번호, 불릿, 체크리스트, 접기/펼치기           │
│  ■ 테이블: 셀 병합, 배경색, 텍스트 정렬                  │
│  ■ 미디어: 이미지(리사이즈), 비디오, 파일 첨부            │
│  ■ 다이어그램: DrawIO, Excalidraw                       │
│  ■ 수학: KaTeX 인라인/블록 수식                          │
│  ■ 코드: 85+ 언어 구문 강조, Mermaid 다이어그램           │
│  ■ 임베드: YouTube, 외부 URL                            │
│  ■ 협업: @멘션, 댓글 마킹, 날짜 선택기                   │
│  ■ 검색: Ctrl+F 문서 내 검색/치환                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.3 그룹웨어 통합

**iframe 통신 브릿지**

```
그룹웨어 (Parent Window)              CoviWiki (iframe)
         │                                    │
         │──── REQUEST_READY ────────────────▶│
         │◀─── COVIWIKI_READY (pageId) ──────│
         │                                    │
         │──── SET_PAGE_EDIT_MODE ───────────▶│  읽기/편집 모드 전환
         │──── COVIWIKI_RESTORE_PAGE ────────▶│  히스토리에서 복원
         │──── COVIWIKI_TEMPLATE_USE ────────▶│  템플릿 적용
         │──── REQUEST_HEADINGS ─────────────▶│  목차 요청
         │◀─── receiveHeadings(headings) ────│  목차 응답
         │──── SCROLL_TO_HEADING ────────────▶│  목차 클릭 → 스크롤
         │──── COVIWIKI_SET_COMMENT ─────────▶│  댓글 인라인 마킹
         │                                    │
         │◀─── goPage(pageInfo) ─────────────│  페이지 이동 요청
         │◀─── previewFile(fileId, token) ───│  문서 미리보기 요청
         │◀─── updateOnlineUsers(users) ─────│  접속자 목록 갱신
         │◀─── updateConnectStatus(status) ──│  연결 상태 표시
```

**인증 흐름**

```
사용자 → 그룹웨어 로그인 → 세션 생성 (X-User-Code, X-Company-Code)
                              │
                              ▼
                    CoviWiki /api/auth/auto-login
                              │
                              ├─ 사용자 존재 확인 (sys_object_user)
                              ├─ JWT 생성 (sub: userCode, workspaceId: companyCode)
                              └─ CWAT 쿠키 설정 (2시간 만료)
                              │
                              ▼
                    이후 모든 API 요청에 CWAT 쿠키 자동 포함
                              │
                              ├─ DomainMiddleware: workspaceId 추출
                              ├─ JwtAuthGuard: 토큰 검증 + 사용자 조회
                              └─ SpaceAbilityFactory: CASL 권한 체크
```

### 3.4 엔터프라이즈 기능

| 기능 | 설명 |
|------|------|
| **결재 워크플로우** | 스페이스별 결재 활성화, DRAFT → PUBLISHED 상태 관리 |
| **페이지 비밀번호** | SHA-512 해싱, 페이지별 비밀번호 보호 |
| **권한 관리** | CASL 기반 RBAC (Admin, Writer, Reader) + 스페이스별 멤버 역할 |
| **파일 토큰** | HMAC-SHA256 기반 시한부 토큰으로 Synap 문서 뷰어 연동 |
| **내보내기** | HTML, Markdown, ZIP (첨부파일 포함) 형식 지원 |
| **전문 검색** | DB별 최적화 - PostgreSQL(tsvector), MySQL(FULLTEXT), Oracle(LIKE 폴백) |
| **페이지 히스토리** | 모든 편집 기록 자동 저장, 특정 버전으로 복원 가능 |
| **백링크** | @멘션 기반 양방향 페이지 참조 자동 추적 |
| **공유** | 사용자/그룹 단위 페이지 공유, 읽기/쓰기 권한 분리 |

---

## 4. 기술 스택 및 선택 이유

### 4.1 Backend

| 기술 | 선택 이유 |
|------|-----------|
| **NestJS + Fastify** | 모듈 기반 아키텍처로 대규모 서비스 구조화 용이. Fastify는 Express 대비 2~3배 빠른 요청 처리 성능. 데코레이터 패턴으로 Guard, Interceptor, Pipe 등 미들웨어 체계적 구성 가능 |
| **Kysely ORM** | TypeScript 네이티브 타입 안전성이 핵심 선택 이유. Knex와 달리 쿼리 빌더 단계에서 컴파일 타임 타입 체크. 런타임 오버헤드가 적은 경량 ORM. 다이얼렉트 플러그인으로 멀티 DB 지원이 깔끔함 |
| **Hocuspocus** | Yjs CRDT의 공식 서버 구현체. WebSocket 기반 실시간 동기화 + 인증/영속화 확장 포인트 제공. TipTap 에디터와 네이티브 통합 |
| **BullMQ** | Redis 기반으로 별도 메시지 브로커 불필요. 재시도/지수 백오프, 작업 상태 추적 등 엔터프라이즈급 큐 기능. 백링크 추출, 이메일 발송 등 비동기 작업에 활용 |
| **Socket.IO** | Redis 어댑터로 멀티 Pod 간 이벤트 브로드캐스트. 스페이스 기반 Room 분리로 효율적 이벤트 라우팅. 페이지 트리 실시간 동기화에 활용 |

### 4.2 Frontend

| 기술 | 선택 이유 |
|------|-----------|
| **React 18 + Vite** | Fast Refresh로 빠른 개발 사이클. Rollup 기반 빌드로 최적화된 청크 분리. `RESOURCE_VERSION` 환경변수로 캐시 버스팅 |
| **TipTap (ProseMirror)** | 확장 가능한 리치 텍스트 에디터. NodeView로 React 컴포넌트를 에디터 노드에 직접 렌더링. Yjs 협업 확장, 슬래시 커맨드, 드래그 앤 드롭 등 풍부한 에코시스템 |
| **Jotai** | 최소한의 보일러플레이트로 전역 상태 관리. `atomWithStorage`로 localStorage 영속화. optics 통합으로 깊은 객체 프로퍼티 파생 상태 생성 용이 |
| **TanStack Query** | 서버 상태와 클라이언트 상태 분리. 5분 staleTime으로 불필요한 재요청 방지. Infinite Query로 사이드바 페이지 목록 무한 스크롤. 뮤테이션 후 캐시 자동 무효화 |
| **Mantine UI** | 엔터프라이즈 수준의 컴포넌트 라이브러리. 모달, 노티피케이션, 스포트라이트 등 복합 UI 패턴 제공. CSS Variables로 다크/라이트 모드 지원 |
| **CASL** | 클라이언트/서버 동일한 권한 정의 공유. AbilityBuilder로 역할 기반 권한을 선언적으로 정의 |

### 4.3 Infrastructure

| 기술 | 선택 이유 |
|------|-----------|
| **Redis** | 다목적 활용: WebSocket 어댑터(Pub/Sub), BullMQ 큐 백엔드, Yjs 문서 상태 캐시, Collaboration Awareness 동기화. Sentinel 모드로 HA 구성 가능 |
| **Docker** | 멀티 스테이지 빌드로 Node 22 Alpine 이미지 경량화. API 서버와 Collaboration 서버 독립 스케일링 가능 |
| **pnpm + Nx** | pnpm의 심볼릭 링크 기반 의존성으로 디스크 절약. Nx 빌드 캐싱으로 모노레포 빌드 시간 단축. `editor-ext` 패키지를 서버/클라이언트에서 공유 |

### 4.4 멀티 DB 아키텍처

```
                    ┌──────────────────┐
                    │   Kysely ORM     │
                    │   (Query Builder)│
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌─────────────┐
     │ MySQL/MariaDB│ │ PostgreSQL│ │   Oracle     │
     │   Dialect    │ │  Dialect  │ │  Dialect     │
     │              │ │           │ │ (직접 구현)   │
     ├──────────────┤ ├───────────┤ ├─────────────┤
     │ JSON_OBJECT  │ │ jsonb     │ │ 문자열 연결  │
     │ FULLTEXT     │ │ tsvector  │ │ LIKE 폴백   │
     │ MATCH AGAINST│ │ ts_rank   │ │ ROWNUM 페이징│
     │ utf8mb4      │ │ INT8 파싱 │ │ Thick/Thin  │
     └──────────────┘ └───────────┘ └─────────────┘
```

**QueryBuilder 추상화**: DB별 차이를 추상화하는 어댑터 패턴 적용
- `JsonBuilder`: DB별 JSON 생성 구문 차이 통합 (JSON_OBJECT vs jsonb vs 문자열 연결)
- `TableNames`: 스키마 프리픽싱 자동화 (`covi_wiki.wiki_pages` vs `gwuser.wiki_pages`)
- `PaginationHelper`: DB별 페이징 문법 차이 처리

---

## 5. 트러블슈팅 경험

### 5.1 멀티 Pod 환경에서 실시간 협업 동기화 문제

**문제**: Kubernetes 환경에서 2개 이상의 Pod으로 스케일 아웃 시, 서로 다른 Pod에 연결된 사용자 간 실시간 편집이 동기화되지 않는 현상 발생. 사용자 A(Pod 1)의 편집 내용이 사용자 B(Pod 2)에게 전달되지 않음.

**원인 분석**:
- Hocuspocus 서버는 기본적으로 인메모리 상태만 관리
- 각 Pod의 Hocuspocus 인스턴스가 독립적으로 동작하여 Yjs Document 상태가 분리됨
- WebSocket 연결은 L4 로드밸런서에 의해 특정 Pod에 고정(sticky session)

**해결 방법**:
```
Pod 1 (Hocuspocus)          Redis Pub/Sub             Pod 2 (Hocuspocus)
       │                         │                          │
       │── Yjs Update ──────▶  채널 발행  ──────────────▶  │
       │   (coviwiki:yjs:updates)                          │
       │                                                    │
       │◀── Awareness Sync ── 채널 구독 ◀──────────────── │
       │   (coviwiki:yjs:awareness)                        │
       │                                                    │
       │   Redis에 Doc State 캐시 (TTL 1시간)              │
```

- **RedisSyncExtension** 커스텀 확장 개발 (450+ 라인)
- Redis Pub/Sub 채널로 Yjs Update/Awareness 이벤트 브로드캐스트
- `transactionOrigin` 추적으로 업데이트 루프 방지 (자기가 발행한 이벤트 무시)
- Redis에 문서 상태 캐시 저장 (TTL 기반, `COLLAB_DOC_TTL` 설정 가능)
- 새 Pod이 뜰 때 Redis 캐시에서 최신 상태 복원

**결과**: 최대 5개 Pod 환경에서 100명 이상 동시 편집 안정적 동작 확인

---

### 5.2 Oracle 11g 호환성 문제

**문제**: 고객사 Oracle 11g 환경에서 Kysely ORM이 동작하지 않음. Kysely에는 Oracle 다이얼렉트가 공식 제공되지 않았고, Oracle 11g는 Thin 모드를 지원하지 않아 oracledb 라이브러리의 Thick 모드가 필요.

**원인 분석**:
- Kysely의 공식 다이얼렉트는 MySQL, PostgreSQL, SQLite만 지원
- Oracle의 JSON 함수(`JSON_OBJECT`)는 12c 이상에서만 지원
- 11g는 Oracle Instant Client가 필수이며, 연결 방식이 완전히 다름
- 페이징 문법도 `OFFSET...FETCH`가 아닌 `ROWNUM` 기반

**해결 방법**:
- Kysely용 **Oracle Dialect를 직접 구현** (`dialects/oracle.dialect.ts`)
- Oracle 버전에 따른 분기 처리:
  - 11g: Thick 모드 + Instant Client 경로 설정
  - 12c+: Thin 모드 사용
- JSON 빌드를 문자열 연결로 대체:
  ```sql
  -- MySQL: JSON_OBJECT('id', user_id, 'name', displayname)
  -- PostgreSQL: json_build_object('id', user_id, 'name', displayname)
  -- Oracle 11g: '{"id":"' || user_id || '","name":"' || displayname || '"}'
  ```
- 전문 검색은 LIKE 기반 폴백으로 처리
- QueryBuilder에 Oracle 어댑터 추가로 호출 코드 변경 최소화

**결과**: 단일 코드베이스로 MySQL, PostgreSQL, Oracle 11g/19c 모두 지원

---

### 5.3 iframe 환경에서의 인증 쿠키 문제

**문제**: 그룹웨어(domain-a.com) 내 iframe에 로드된 CoviWiki(domain-b.com)에서 CWAT 인증 쿠키가 전달되지 않는 현상. Chrome 80+ 이후 SameSite=Lax가 기본값이 되면서 Cross-Site 쿠키가 차단됨.

**원인 분석**:
- 브라우저의 Third-Party Cookie 정책 강화
- SameSite=None 설정 시 Secure 플래그 필수 (HTTPS 필요)
- 개발 환경은 HTTP여서 Secure 쿠키 사용 불가

**해결 방법**:
- 그룹웨어와 CoviWiki를 **동일 도메인 하위 경로**로 배포하는 아키텍처 채택
  - 그룹웨어: `company.com/`
  - CoviWiki: `company.com/coviwiki/`
- 리버스 프록시(Nginx/Apache)에서 경로 기반 라우팅:
  ```
  /coviwiki/api/*     → CoviWiki API Server (Port 3000)
  /coviwiki/collab/*  → Collaboration Server (Port 3001)
  /coviwiki/*         → CoviWiki Static Files
  /*                  → Groupware (Java/Spring)
  ```
- 쿠키는 동일 도메인이므로 SameSite 문제 자연 해소
- Vite 빌드의 `base` 경로를 `/coviwiki/`로 설정

**결과**: 별도 도메인 없이 기존 그룹웨어 도메인에서 원활하게 동작

---

### 5.4 대규모 페이지 트리 렌더링 성능 문제

**문제**: 500개 이상의 페이지가 있는 스페이스에서 사이드바 트리가 초기 로딩에 5초 이상 소요. 페이지 이동/생성 시에도 전체 트리 리렌더링으로 UI 프리징 발생.

**원인 분석**:
- 전체 페이지 트리를 한 번에 로드하는 비효율적 쿼리
- React 컴포넌트 트리가 매 변경마다 전체 리렌더링
- Socket.IO 이벤트마다 React Query 캐시 전체 무효화

**해결 방법**:
- **서버**: 페이지네이션 기반 트리 로딩 (한 번에 250개 제한, Infinite Query)
- **클라이언트**: react-arborist의 SimpleTree 인메모리 트리 활용
  ```
  WebSocket 이벤트 수신
        │
        ▼
  SimpleTree API로 해당 노드만 조작
  (addTreeNode / moveTreeNode / deleteTreeNode)
        │
        ▼
  영향받는 컴포넌트만 리렌더링 (React.memo)
        │
        ▼
  React Query는 해당 페이지 키만 무효화
  ```
- Socket.IO 이벤트 핸들러에서 트리 조작과 쿼리 무효화를 분리
- `keepPreviousData` 옵션으로 페이지네이션 전환 시 깜빡임 방지

**결과**: 1000+ 페이지 스페이스에서도 초기 로딩 1초 이내, 실시간 업데이트 즉시 반영

---

### 5.5 HWP(한글) 문서 붙여넣기 깨짐

**문제**: 한컴오피스(HWP) 문서에서 복사 후 에디터에 붙여넣기 시 서식이 완전히 깨지거나 빈 텍스트로 입력되는 현상. 한국 기업 환경에서 HWP 사용 빈도가 높아 치명적인 UX 문제.

**원인 분석**:
- HWP 클립보드 데이터는 표준 HTML이 아닌 독자 포맷
- TipTap의 기본 paste 핸들러가 HWP 포맷을 인식하지 못함
- Excel 테이블 데이터도 유사한 문제 존재

**해결 방법**:
- **커스텀 Paste Handler** 확장 개발
  - 클립보드 MIME 타입 분석으로 HWP/Excel 감지
  - HWP: HTML 변환 fallback 적용, 서식 매핑 테이블 구현
  - Excel: 테이블 구조 자동 감지 후 TipTap Table 노드로 변환
  - Markdown 클립보드도 별도 핸들러로 처리

**결과**: HWP/Excel/Markdown 붙여넣기 정상 동작

---

## 6. 성능 개선 사례

### 6.1 협업 서버 DB 저장 최적화

**Before**: 매 키 입력마다 Yjs Update → 즉시 DB 저장 → 초당 수십 회 DB 쓰기

**After**: 디바운스 윈도우 적용
```
사용자 입력 ──▶ Yjs Update (인메모리) ──▶ 10초 대기 ──▶ DB 저장
                                           │
                                           ├─ 10초 내 추가 입력 시: 타이머 리셋
                                           └─ 최대 45초까지 대기 후 강제 저장
```

**개선 효과**:
- DB 쓰기 빈도: ~50회/초 → ~1회/10초 (99.8% 감소)
- 저장 시 Deep Equality 체크로 실제 변경 없으면 DB 스킵
- 첨부파일 고아 정리(orphan cleanup)도 저장 시점에 배치 처리

### 6.2 Awareness 하트비트 최적화

**Before**: 사용자 커서 이동마다 Redis Pub/Sub 발행 → 초당 수백 메시지

**After**:
```
커서 이동 이벤트
     │
     ▼
  10초 간격 하트비트로 집약 (Redis Pod delay 허용)
     │
     ▼
  사용자 목록 변경 시에만 UI 갱신 (하트비트 자체는 무시)
     │
     ▼
  5분 유휴 시 자동 연결 해제 → 탭 활성화 시 재연결
```

**개선 효과**:
- Redis 메시지 볼륨 90% 감소
- 비활성 탭의 불필요한 리소스 소비 제거

### 6.3 프론트엔드 렌더링 최적화

| 최적화 항목 | 적용 방법 | 효과 |
|------------|-----------|------|
| **에디터 메모이제이션** | `React.memo(TitleEditor)`, `React.memo(PageEditor)` | 불필요한 리렌더링 방지 |
| **Query 캐싱** | staleTime 5분, refetchOnMount/Focus 비활성화 | API 호출 70% 감소 |
| **에디터 입력 디바운스** | `useDebouncedCallback` 3초 | 입력 중 상태 업데이트 최소화 |
| **캐시 버스팅** | `RESOURCE_VERSION` 환경변수로 에셋 버전 관리 | 배포 시 즉시 캐시 갱신 |
| **코드 스플리팅** | Vite rollupOptions + 라우트 기반 분리 | 초기 번들 크기 40% 감소 |

### 6.4 DB 클러스터링 지원

**문제**: 단일 DB 인스턴스 한계로 대규모 사용 시 쿼리 지연

**해결**: MySQL/MariaDB 클러스터링 지원 구현
```
애플리케이션
     │
     ▼
Round-Robin 로드 분배 (*::RR)
     │
     ├──▶ Node 1 (192.168.1.1)
     ├──▶ Node 2 (192.168.1.2)
     └──▶ Node 3 (192.168.1.3)

 ■ 노드 장애 시: 5회 에러 후 자동 제외
 ■ 복구 감지: 30초마다 헬스체크 후 자동 복귀
 ■ 커넥션 풀: 전체 풀을 노드 수로 균등 분배
```

### 6.5 백링크 비동기 처리

**Before**: 페이지 저장 시 동기적으로 @멘션 파싱 → 백링크 테이블 갱신 → 저장 지연

**After**: BullMQ 큐로 비동기 처리
```
페이지 저장 (Collaboration Store)
     │
     ├── DB 업데이트 (즉시)
     │
     └── 큐에 백링크 작업 추가 ──▶ BacklinksProcessor (비동기)
                                        │
                                        ├── ProseMirror에서 멘션 추출
                                        ├── 기존 백링크와 비교
                                        ├── 새 멘션 추가
                                        └── 삭제된 멘션 제거
```

**개선 효과**: 페이지 저장 응답 시간 200ms → 50ms (75% 단축)

---

## 7. 회고

### 7.1 잘된 점

**오픈소스 활용 전략**
- Docmost라는 성숙한 오픈소스를 Fork함으로써 에디터, 실시간 협업 등 핵심 기능을 빠르게 확보
- 그룹웨어 통합이라는 비즈니스 로직에 집중할 수 있었음
- TipTap, Yjs, Hocuspocus 등 검증된 라이브러리 조합으로 안정성 확보

**모듈화된 아키텍처**
- NestJS의 모듈 시스템을 활용하여 `GwModule`을 독립적으로 개발
- 코어 모듈과 그룹웨어 통합 모듈을 분리하여 원본 Docmost 업데이트 반영 용이
- Bridge 패턴으로 iframe 통신을 체계적으로 관리

**확장 가능한 설계**
- 멀티 DB 지원으로 다양한 고객사 환경 대응
- Redis Sentinel, DB Clustering 등 HA 구성 지원
- Collaboration 서버 분리로 독립적 수평 확장 가능

### 7.2 아쉬운 점

**테스트 커버리지 부족**
- 1인 개발 + 빠른 일정으로 단위 테스트가 서비스 존재 확인 수준에 머물렀음
- 특히 멀티 DB 환경별 통합 테스트가 부재하여 Oracle 배포 시 예기치 못한 이슈 발생
- 향후 개선: DB별 Docker 기반 통합 테스트 환경 구축 필요

**프론트엔드 상태 관리 복잡성**
- Jotai(클라이언트 상태) + TanStack Query(서버 상태) + Socket.IO(실시간 상태)의 3중 상태 관리가 복잡
- 특히 페이지 트리의 낙관적 업데이트와 서버 동기화 간 경합 조건(Race Condition) 처리가 까다로웠음
- 상태 흐름 다이어그램 문서화가 부족하여 디버깅 시간 증가

**모니터링 체계 미흡**
- 실시간 협업 서버의 연결 수, 메모리 사용량 등 메트릭 수집 미구현
- 문제 발생 시 로그 기반 사후 분석에 의존
- Prometheus + Grafana 연동 등 관측 가능성(Observability) 개선 필요

### 7.3 배운 점

**CRDT와 실시간 시스템의 복잡성**
- Yjs의 CRDT는 충돌 해결을 자동화해주지만, 네트워크 파티션, 순서 보장, 상태 복원 등 분산 시스템 고유의 문제는 여전히 직접 다뤄야 함
- Redis Pub/Sub 기반 멀티 Pod 동기화를 구현하면서 분산 시스템 설계 원칙을 체감

**레거시 시스템 통합의 현실**
- 엔터프라이즈 환경에서는 최신 기술만으로 해결할 수 없는 호환성 문제가 항상 존재
- Oracle 11g, IE 호환, HWP 포맷 등 한국 기업 특수 환경에 대한 대응이 실제 업무의 상당 부분을 차지
- "동작하게 만들기" → "올바르게 만들기" → "빠르게 만들기" 순서의 중요성 재확인

**iframe 기반 마이크로 프론트엔드**
- postMessage 기반 통신은 단순하지만 타입 안전성 확보가 어려움
- Bridge 패턴과 명확한 메시지 프로토콜 정의가 유지보수성에 큰 영향
- Cross-Origin 정책 이해 없이는 iframe 통합이 불가능하다는 것을 체감

---

## 기술 요약

```
Frontend  : React 18, TypeScript, Vite, TipTap, Yjs, Mantine UI, Jotai, TanStack Query
Backend   : NestJS 11, Fastify, Kysely ORM, Hocuspocus, Socket.IO, BullMQ
Database  : MySQL/MariaDB, PostgreSQL, Oracle (멀티 DB 지원)
Infra     : Redis (Sentinel HA), Docker, Nx Monorepo, pnpm Workspace
Real-time : Yjs CRDT, Hocuspocus WebSocket, Redis Pub/Sub, Socket.IO
Auth      : JWT (CWAT Cookie), CASL RBAC, HMAC-SHA256 File Token
i18n      : 4개 언어 (한국어, 영어, 일본어, 중국어)
```
