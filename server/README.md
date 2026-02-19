# Server — 백엔드 커스텀 코드

Docmost 서버 아키텍처 위에 구축한 커스텀 NestJS 백엔드 모듈입니다.

## 디렉토리 구성

### `main.ts` — 애플리케이션 엔트리 포인트 [MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `main.ts` | 164 | Referer 검증 훅, 워크스페이스 유효성 검사, Fastify 커스텀 설정 |

### `gw/` — 그룹웨어 통합 모듈 [NEW]

엔터프라이즈 그룹웨어(Java/Spring)와 CoviWiki 간의 핵심 통합 레이어입니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `gw.module.ts` | 17 | NestJS 모듈 정의 |
| `gw.controller.ts` | 317 | 그룹웨어 전용 REST API 엔드포인트 (페이지 목록, 스페이스 관리, 결재 워크플로우, 알림) |
| `file-token.service.ts` | 117 | Synap 문서 뷰어 연동을 위한 HMAC-SHA256 토큰 생성/검증 |
| `page/dto/gw-page.dto.ts` | 40 | 그룹웨어 페이지 요청 DTO |
| `page/services/gw.service.ts` | 499 | 비즈니스 로직 — 그룹웨어 DB 기반 페이지 CRUD, 사용자 동기화, 공유/결재 기능 |

### `core/` — 도메인 모듈 [MODIFIED]

Docmost 코어 모듈에 그룹웨어 통합, 멀티 DB, 비밀번호 보호 등의 기능을 확장했습니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `page/services/page.service.ts` | 812 | 페이지 비밀번호 검증, JSON 콘텐츠 정규화, 그룹웨어 연동 로직 |
| `page/page.controller.ts` | 498 | 비밀번호 보호 페이지 API, 최근 페이지 조회, 히스토리 관리 확장 |
| `attachment/attachment.controller.ts` | 394 | 회사코드 기반 파일 업로드, JWT 토큰 기반 첨부파일 접근 |
| `attachment/services/attachment.service.ts` | 336 | 그룹웨어 파일 관리 연동 |
| `search/search.service.ts` | 346 | Oracle LIKE 폴백 포함 멀티 DB 전문 검색 (PostgreSQL tsvector, MySQL FULLTEXT) |
| `casl/abilities/space-ability.factory.ts` | 114 | 그룹웨어 관리자(isGwAdmin) 감지, 회사코드 기반 RBAC 권한 |
| `auth/services/token.service.ts` | 92 | companyCode, workspaceId를 포함한 커스텀 JWT 페이로드 생성 |
| `user/user.service.ts` | 67 | 사용자 설정 관리 |

### `database/` — 멀티 DB 지원 [NEW + MODIFIED]

MySQL, PostgreSQL, Oracle을 지원하기 위한 커스텀 데이터베이스 레이어입니다.

**Dialect & 플러그인 [NEW]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `dialects/oracle.dialect.ts` | 662 | Kysely Oracle Dialect 전체 구현 — 드라이버, 컴파일러, 인트로스펙터, 어댑터 |
| `plugins/table-name-mapper.plugin.ts` | 166 | 테이블명 스키마 프리픽스 자동 적용 Kysely 플러그인 |
| `repos/dialects.ts` | 23 | Dialect 레지스트리 — DATABASE_URL 프로토콜 기반 자동 선택 |
| `repos/dialects-oracle.ts` | 62 | Oracle 전용 Dialect 초기화 (트리 셰이킹 분리) |
| `repos/query-builder.ts` | 375 | 3개 DB의 JSON 빌드, 전문 검색, 페이징 차이 통합 |

**Repository [MODIFIED]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `repos/page/page.repo.ts` | 584 | 멀티 DB JSON 파싱/정규화, DEFAULT_DOC 처리, 콘텐츠 sanitization |
| `repos/space/space-member.repo.ts` | 373 | 그룹웨어 연동 배치 멤버 관리, 조직도 기반 일괄 추가 |
| `repos/user/user.repo.ts` | 347 | 그룹웨어 조직도 DB(sys_object_user) 연동 사용자 조회 |

### `collaboration/` — 실시간 협업 [NEW + MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `extensions/redis-sync.extension.ts` | 442 | [NEW] Redis Pub/Sub 멀티 Pod Yjs 동기화 확장 |
| `extensions/persistence.extension.ts` | 220 | [MODIFIED] 첨부파일 추적, 멘션 추출, 디바운스 저장 최적화 (10~45초 윈도우) |
| `extensions/authentication.extension.ts` | 111 | [MODIFIED] 협업 토큰 인증, 스페이스 역할 검증 |
| `listeners/history.listener.ts` | 44 | [MODIFIED] 편집 히스토리 이벤트 리스너 |

### `ws/` — WebSocket 게이트웨이 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `adapter/ws-redis.adapter.ts` | 112 | 멀티 Pod 간 Socket.IO Redis 어댑터 |

### `common/` — 미들웨어 및 데코레이터 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `middlewares/domain.middleware.ts` | 45 | JWT에서 workspaceId 추출, 멀티 테넌트 스코핑 |
| `decorators/auth-company-code.decorator.ts` | 22 | 회사 코드 추출 파라미터 데코레이터 |

### `integrations/` — 환경 설정 [MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `environment/environment.service.ts` | 359 | Redis Sentinel, DB 클러스터링, 스키마 설정, Oracle 경로, 디버그 제어 |
| `environment/environment.validation.ts` | 151 | Oracle 프로토콜 검증, 클러스터링 환경변수, 스키마 필드 |

## 합계: 31개 파일, ~7,900줄
