# Client — 프론트엔드 커스텀 코드

그룹웨어 통합을 위해 구축한 커스텀 React 컴포넌트, 훅, 확장입니다.

## 디렉토리 구성

### `features/editor/` — 에디터 핵심 [NEW + MODIFIED]

**핵심 에디터 컴포넌트 [MODIFIED]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `page-editor.tsx` | 600 | 메인 에디터 — Awareness 접속자 관리, 읽기/편집 모드 오버라이드, Yjs 동기화 오류 자동 복구, 그룹웨어 댓글 연동 |
| `title-editor.tsx` | 261 | 타이틀 에디터 — 그룹웨어 연동 확장 |
| `extensions/extensions.ts` | 286 | TipTap 확장 구성 — 댓글, 한컴, Excel 붙여넣기 등 커스텀 확장 포함 |

**붙여넣기 핸들러 [MODIFIED]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `components/common/editor-paste-handler.tsx` | 214 | HWP/Excel/마크다운 MIME 타입 감지 및 변환 |

**그룹웨어 브릿지 훅 [NEW]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `hooks/use-coviwiki-bridge.ts` | 267 | 핵심 브릿지 훅 — postMessage 수신/디스패치, 네비게이션, 편집 모드, 목차 동기화 |
| `hooks/use-coviwiki-editor.ts` | 236 | 에디터 전용 브릿지 — 헤딩 스크롤, 인라인 댓글 마킹, 콘텐츠 복원 |

**클립보드 확장 [NEW]:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `extensions/excel-paste-table.ts` | 141 | Excel 클립보드 → TipTap 테이블 노드 변환 |
| `extensions/hancom-paste-handler.ts` | 96 | HWP(한컴오피스) 비표준 포맷 파싱 |

### `features/page/` — 페이지 기능 [MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `queries/page-query.ts` | 513 | React Query 훅 — 비밀번호 검증 쿼리, 그룹웨어 전용 API 훅 |
| `services/page-service.ts` | 202 | 페이지 API 서비스 — 비밀번호 검증, 페이지 CRUD |
| `components/page-password-modal.tsx` | 135 | 페이지 비밀번호 입력 모달 — 그룹웨어 메시지(WIKIInbound) 연동 |

### `hooks/` — 유틸리티 훅 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `use-gw-mode.ts` | 13 | URL 경로로 그룹웨어 iframe 모드 감지 |
| `use-idle.ts` | 58 | 사용자 유휴 감지 — 5분 비활성 시 협업 연결 해제 |

### `pages/` — GW 전용 라우트 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `page/use-gw-page-viewer.tsx` | 20 | iframe 모드 페이지 뷰어 |
| `page/use-gw-page-history.tsx` | 20 | 페이지 히스토리 뷰어 |
| `template/use-gw-template-viewer.tsx` | 20 | 템플릿 뷰어 |
| `template/use-gw-template-write.tsx` | 20 | 템플릿 에디터 |
| `template/use-gw-template-history.tsx` | 20 | 템플릿 히스토리 |
| `template/use-gw-template-draft.tsx` | 16 | 템플릿 임시저장 |

### `lib/` — 유틸리티 및 설정 [MODIFIED]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `utils.tsx` | 212 | 그룹웨어 테마/컬러스킴 감지(window.parent), 다국어 표시명 처리 |
| `config.ts` | 99 | GW 전용 URL 설정, 협업 서버 URL 구성 |

## 합계: 21개 파일, ~3,450줄
