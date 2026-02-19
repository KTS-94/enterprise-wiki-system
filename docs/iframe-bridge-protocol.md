# iframe 브릿지 프로토콜

## 개요

CoviWiki는 엔터프라이즈 그룹웨어 애플리케이션 내의 iframe에서 실행됩니다. 부모 창(그룹웨어)과 iframe(위키 에디터) 간 통신은 `window.postMessage` API를 사용합니다.

```
그룹웨어 (부모 창)                    CoviWiki (iframe)
        │                                      │
        │    outbound.js                       │    use-coviwiki-bridge.ts
        │    (메시지 발신)                      │    (수신 및 디스패치)
        │                                      │
        │──── postMessage({type, payload}) ──▶ │
        │◀─── postMessage({type, payload}) ────│
        │                                      │
        │    inbound.js                        │    use-coviwiki-editor.ts
        │    (메시지 수신)                      │    (에디터 전용 액션)
```

## 메시지 타입

### 그룹웨어 → CoviWiki (인바운드)

| 타입 | 페이로드 | 설명 |
|------|---------|------|
| `REQUEST_READY` | `{ pageId }` 또는 `{ scope: "template", templateKey, mode? }` | 초기 핸드셰이크 — 위키에 로드할 페이지/템플릿 지정 |
| `SET_PAGE_EDIT_MODE` | `"edit"` \| `"read"` | 편집/읽기 전용 모드 전환 |
| `SET_FULL_PAGE_WIDTH` | `boolean` | 전체 너비 에디터 레이아웃 토글 |
| `COVIWIKI_NAVIGATE` | `{ slug, pageId }` | 다른 페이지로 네비게이션 |
| `COVIWIKI_RESTORE_PAGE` | `{ title, content }` | 히스토리 버전에서 페이지 복원 |
| `COVIWIKI_TEMPLATE_USE` | `{ title, content }` | 현재 페이지에 템플릿 콘텐츠 적용 |
| `REQUEST_HEADINGS` | — | 목차(TOC) 사이드바용 헤딩 목록 요청 |
| `SCROLL_TO_HEADING` | `number \| string` | 에디터를 특정 헤딩으로 스크롤 |
| `COVIWIKI_SET_COMMENT` | `{ commentId }` | 선택된 텍스트에 인라인 댓글 마크 추가 |
| `COVIWIKI_REMOVE_COMMENT` | `{ commentId }` | 인라인 댓글 마크 제거 |
| `SCROLL_TO_COMMENT_MARK` | `{ commentId }` | 댓글 마크 위치로 스크롤 |
| `TEMPLATE_CREATE` | `string` (템플릿 키) | 새 템플릿 생성 |

### CoviWiki → 그룹웨어 (아웃바운드)

| 타입 | 페이로드 | 설명 |
|------|---------|------|
| `COVIWIKI_READY` | `{ scope, pageId?, templateKey? }` | 위키 로드 완료 및 준비 상태 |
| `goPage` | `{ pageId, title, slug }` | 페이지 네비게이션 요청 (그룹웨어가 URL/브레드크럼 갱신) |
| `receiveHeadings` | `Heading[]` | 목차용 헤딩 목록 반환 |
| `previewFile` | `{ fileId, token }` | Synap 문서 뷰어를 통한 파일 미리보기 요청 |
| `updateOnlineUsers` | `User[]` | 그룹웨어 사이드바의 접속자 목록 갱신 |
| `updateConnectStatus` | `"connected"` \| `"disconnected"` | 협업 연결 상태 |

## 연결 라이프사이클

```
1. 그룹웨어가 iframe에 CoviWiki 로드
   iframe src = "/coviwiki/gw/page/{pageId}"

2. CoviWiki SPA 초기화
   ├─ CWAT 쿠키로 자동 로그인
   ├─ 메시지 리스너 등록 (use-coviwiki-bridge.ts)
   └─ 부모로부터 REQUEST_READY 대기

3. 그룹웨어가 REQUEST_READY 전송
   { type: "REQUEST_READY", payload: { pageId: "abc-123" } }

4. CoviWiki가 COVIWIKI_READY로 응답
   { type: "COVIWIKI_READY", payload: { scope: "page", pageId: "abc-123" } }

5. 양방향 통신 확립
   ├─ 그룹웨어: 편집 모드 변경, 스크롤 명령 등 전송 가능
   └─ CoviWiki: 페이지 네비게이션, 파일 미리보기 등 요청 가능
```

## 구현 상세

### 클라이언트 측 (`use-coviwiki-bridge.ts` — 267줄)

브릿지 훅이 `message` 이벤트 리스너를 설정하고 수신 메시지를 적절한 핸들러로 디스패치합니다:

```typescript
export function useCoviWikiBridge() {
  useEffect(() => {
    const handler = (event: MessageEvent<BridgeMsg>) => {
      switch (event.data.type) {
        case 'REQUEST_READY':
          // 부모에게 COVIWIKI_READY 전송
          break;
        case 'SET_PAGE_EDIT_MODE':
          // 에디터에 커스텀 이벤트 디스패치
          document.dispatchEvent(
            new CustomEvent('COVIWIKI_SET_MODE', { detail: payload })
          );
          break;
        case 'REQUEST_HEADINGS':
          // 에디터에서 헤딩 추출, 부모에게 전송
          break;
        // ... 기타 메시지 타입
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
```

### 에디터 통합 (`use-coviwiki-editor.ts` — 236줄)

TipTap 에디터 인스턴스에 접근이 필요한 에디터 전용 브릿지 액션을 처리하는 별도 훅입니다:

- 인덱스로 헤딩 위치 스크롤
- 인라인 댓글 마크 삽입/제거
- 문서에서 헤딩 목록 추출
- 템플릿 또는 히스토리 복원 콘텐츠 적용

### 타입 안전성

모든 메시지는 Discriminated Union으로 타입이 지정됩니다:

```typescript
type BridgeMsg =
  | { type: "REQUEST_READY"; payload: RequestReadyPayload }
  | { type: "SET_PAGE_EDIT_MODE"; payload: PageEditMode }
  | { type: "COVIWIKI_RESTORE_PAGE"; payload: { title: any; content: any } }
  | { type: "REQUEST_HEADINGS" }
  | { type: "SCROLL_TO_HEADING"; payload: number | string }
  // ... 등
```

### 그룹웨어 측 (JavaScript)

그룹웨어는 3개의 브릿지 스크립트를 사용합니다:

| 스크립트 | 역할 |
|----------|------|
| `coviWiki.base.js` | 설정, iframe URL 구성 |
| `coviWiki.outbound.js` | CoviWiki iframe에 메시지 전송 |
| `coviWiki.inbound.js` | CoviWiki에서 보낸 메시지 수신 및 처리 |

아웃바운드 호출 예시:
```javascript
// coviWiki.outbound.js
function setEditMode(mode) {
  wikiIframe.contentWindow.postMessage(
    { type: 'SET_PAGE_EDIT_MODE', payload: mode },
    window.location.origin
  );
}
```

## GW 전용 라우트

CoviWiki는 그룹웨어 통합을 위한 전용 라우트 컴포넌트를 포함합니다. 기본 위키 크롬(사이드바, 헤더)을 제거하고 에디터 콘텐츠만 표시합니다:

| 컴포넌트 | 라우트 | 용도 |
|----------|--------|------|
| `use-gw-page-viewer.tsx` | `/gw/page/:pageId` | 페이지 뷰어 (iframe 모드) |
| `use-gw-page-history.tsx` | `/gw/page/:pageId/history` | 페이지 히스토리 뷰어 |
| `use-gw-template-viewer.tsx` | `/gw/template/:key` | 템플릿 뷰어 |
| `use-gw-template-write.tsx` | `/gw/template/:key/write` | 템플릿 에디터 |
| `use-gw-template-history.tsx` | `/gw/template/:key/history` | 템플릿 히스토리 |
| `use-gw-template-draft.tsx` | `/gw/template/:key/draft` | 템플릿 임시저장 |

## GW 모드 감지 (`use-gw-mode.ts`)

URL 경로를 확인하여 앱이 그룹웨어 모드에서 실행 중인지 감지하는 경량 훅입니다:

```typescript
export function useGwMode() {
  return useMemo(() =>
    window.location.pathname.startsWith('/coviwiki/gw/'),
    []
  );
}
```

GW 모드에서는 기본 사이드바와 네비게이션을 숨기고, 부모 그룹웨어가 제공하는 UI 요소에 의존합니다.
