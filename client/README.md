# Client — 프론트엔드 커스텀 코드

그룹웨어 통합을 위해 구축한 커스텀 React 컴포넌트, 훅, 확장입니다.

## 디렉토리 구성

### `features/editor/hooks/` — 그룹웨어 브릿지 [NEW]

위키 에디터와 부모 그룹웨어 iframe 간의 통신 레이어입니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `use-coviwiki-bridge.ts` | 267 | 핵심 브릿지 훅 — `postMessage` 리스너, 메시지 디스패칭, 페이지 네비게이션, 편집 모드 제어, 목차 동기화 |
| `use-coviwiki-editor.ts` | 236 | 에디터 전용 브릿지 액션 — 헤딩 스크롤, 인라인 댓글 마킹, 콘텐츠 복원, 템플릿 적용 |

### `features/editor/extensions/` — 클립보드 핸들러 [NEW]

한국 기업 환경의 오피스 포맷을 위한 커스텀 붙여넣기 핸들러입니다.

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `excel-paste-table.ts` | 141 | Excel 클립보드 데이터를 감지하여 셀 구조를 유지한 TipTap 테이블 노드로 변환 |
| `hancom-paste-handler.ts` | 96 | HWP(한컴오피스) 붙여넣기 처리 — 비표준 클립보드 MIME 타입 파싱 후 에디터 노드로 매핑 |

### `hooks/` — 유틸리티 훅 [NEW]

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `use-gw-mode.ts` | 13 | URL 경로(`/coviwiki/gw/...`)로 그룹웨어 iframe 모드 감지 |
| `use-idle.ts` | 58 | 사용자 유휴 감지 — 5분 비활성 시 협업 연결 해제, 탭 포커스 시 재연결 |

### `pages/` — GW 전용 라우트 컴포넌트 [NEW]

그룹웨어 통합을 위한 전용 라우트 컴포넌트입니다. 기본 위키 크롬(사이드바, 헤더)을 제거하고 에디터/뷰어만 렌더링합니다. 부모 그룹웨어가 네비게이션 UI를 제공하기 때문입니다.

**페이지 라우트:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `page/use-gw-page-viewer.tsx` | 20 | iframe 모드 페이지 뷰어 |
| `page/use-gw-page-history.tsx` | 20 | 페이지 히스토리 뷰어 |

**템플릿 라우트:**

| 파일 | 라인 수 | 설명 |
|------|-------:|------|
| `template/use-gw-template-viewer.tsx` | 20 | 템플릿 뷰어 |
| `template/use-gw-template-write.tsx` | 20 | 템플릿 에디터 |
| `template/use-gw-template-history.tsx` | 20 | 템플릿 히스토리 |
| `template/use-gw-template-draft.tsx` | 16 | 템플릿 임시저장 |

## 합계: 12개 파일, ~930줄
