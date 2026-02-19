# Server — 백엔드 커스텀 코드

Docmost 서버 아키텍처 위에 구축한 커스텀 NestJS 백엔드 모듈입니다.

## 디렉토리 구성

### `gw/` — 그룹웨어 통합 모듈 [NEW]

엔터프라이즈 그룹웨어(Java/Spring)와 CoviWiki 간의 핵심 통합 레이어입니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `gw.module.ts` | 17 | NestJS 모듈 정의 |
| `gw.controller.ts` | 317 | 그룹웨어 전용 REST API 엔드포인트 (페이지 목록, 스페이스 관리, 결재 워크플로우, 알림) |
| `file-token.service.ts` | 117 | Synap 문서 뷰어 연동을 위한 HMAC-SHA256 토큰 생성/검증 |
| `page/dto/gw-page.dto.ts` | 40 | 그룹웨어 페이지 요청 DTO |
| `page/services/gw.service.ts` | 499 | 비즈니스 로직 — 그룹웨어 DB 기반 페이지 CRUD, 사용자 동기화, 공유/결재 기능 |

### `database/` — 멀티 DB 지원 [NEW]

MySQL, PostgreSQL과 함께 Oracle을 지원하기 위한 커스텀 데이터베이스 레이어입니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `dialects/oracle.dialect.ts` | 662 | Kysely Oracle Dialect 전체 구현 — 드라이버, 컴파일러, 인트로스펙터, 어댑터. 11g (Thick) 및 12c+ (Thin) 모드 지원 |
| `plugins/table-name-mapper.plugin.ts` | 166 | 테이블명에 스키마 프리픽스를 자동 적용하는 Kysely 플러그인 (예: `covi_wiki.wiki_pages`) |
| `repos/dialects.ts` | 23 | Dialect 레지스트리 — `DATABASE_URL` 프로토콜에 따라 Dialect 자동 선택 |
| `repos/dialects-oracle.ts` | 62 | Oracle 전용 Dialect 초기화 (트리 셰이킹을 위해 분리) |
| `repos/query-builder.ts` | 375 | 통합 쿼리 추상화 — 3개 DB의 JSON 빌드, 전문 검색, 페이징 차이를 통합 |

### `collaboration/` — 실시간 협업 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `extensions/redis-sync.extension.ts` | 442 | Redis Pub/Sub 기반 멀티 Pod Yjs 동기화 Hocuspocus 확장. 문서 상태 캐싱, Awareness 브로드캐스팅, 루프 방지 처리 |

### `ws/` — WebSocket 게이트웨이 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `adapter/ws-redis.adapter.ts` | 112 | 멀티 Pod 간 이벤트 브로드캐스팅을 위한 Socket.IO Redis 어댑터 (페이지 트리 실시간 동기화) |

### `common/` — 미들웨어 및 데코레이터 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `middlewares/domain.middleware.ts` | 45 | JWT에서 workspaceId를 추출하여 멀티 테넌트 요청 스코핑 처리 |
| `decorators/auth-company-code.decorator.ts` | 22 | 인증된 사용자 컨텍스트에서 회사 코드를 추출하는 파라미터 데코레이터 |

### `integrations/` — 환경 설정 [MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `environment/environment.service.ts` | 359 | ~180줄 추가: Redis Sentinel, DB 클러스터링, 스키마 설정, Oracle 경로, 디버그 제어, 협업 TTL |
| `environment/environment.validation.ts` | 151 | ~30줄 추가: Oracle 프로토콜 검증, 클러스터링 환경변수, 스키마 필드 |

## 합계: 16개 파일, ~3,400줄
