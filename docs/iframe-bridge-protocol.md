# iframe Bridge Protocol

## Overview

CoviWiki runs inside an iframe within the enterprise groupware application. Communication between the parent window (groupware) and the iframe (wiki editor) uses the `window.postMessage` API.

```
Groupware (Parent Window)              CoviWiki (iframe)
        │                                      │
        │    outbound.js                       │    use-coviwiki-bridge.ts
        │    (sends messages)                  │    (receives & dispatches)
        │                                      │
        │──── postMessage({type, payload}) ──▶ │
        │◀─── postMessage({type, payload}) ────│
        │                                      │
        │    inbound.js                        │    use-coviwiki-editor.ts
        │    (receives messages)               │    (editor-specific actions)
```

## Message Types

### Groupware → CoviWiki (Inbound)

| Type | Payload | Description |
|------|---------|-------------|
| `REQUEST_READY` | `{ pageId }` or `{ scope: "template", templateKey, mode? }` | Initial handshake — tells the wiki which page/template to load |
| `SET_PAGE_EDIT_MODE` | `"edit"` \| `"read"` | Toggle between edit and read-only mode |
| `SET_FULL_PAGE_WIDTH` | `boolean` | Toggle full-width editor layout |
| `COVIWIKI_NAVIGATE` | `{ slug, pageId }` | Navigate to a different page |
| `COVIWIKI_RESTORE_PAGE` | `{ title, content }` | Restore page from history version |
| `COVIWIKI_TEMPLATE_USE` | `{ title, content }` | Apply template content to current page |
| `REQUEST_HEADINGS` | — | Request heading list for TOC sidebar |
| `SCROLL_TO_HEADING` | `number \| string` | Scroll editor to specific heading |
| `COVIWIKI_SET_COMMENT` | `{ commentId }` | Add inline comment mark to selected text |
| `COVIWIKI_REMOVE_COMMENT` | `{ commentId }` | Remove inline comment mark |
| `SCROLL_TO_COMMENT_MARK` | `{ commentId }` | Scroll to comment mark position |
| `TEMPLATE_CREATE` | `string` (template key) | Create new template |

### CoviWiki → Groupware (Outbound)

| Type | Payload | Description |
|------|---------|-------------|
| `COVIWIKI_READY` | `{ scope, pageId?, templateKey? }` | Wiki is loaded and ready |
| `goPage` | `{ pageId, title, slug }` | Request page navigation (groupware updates URL/breadcrumb) |
| `receiveHeadings` | `Heading[]` | Return heading list for TOC |
| `previewFile` | `{ fileId, token }` | Request document preview via Synap DocViewer |
| `updateOnlineUsers` | `User[]` | Update online user list in groupware sidebar |
| `updateConnectStatus` | `"connected"` \| `"disconnected"` | Collaboration connection status |

## Connection Lifecycle

```
1. Groupware loads CoviWiki in iframe
   iframe src = "/coviwiki/gw/page/{pageId}"

2. CoviWiki SPA initializes
   ├─ Auto-login via CWAT cookie
   ├─ Register message listener (use-coviwiki-bridge.ts)
   └─ Wait for REQUEST_READY from parent

3. Groupware sends REQUEST_READY
   { type: "REQUEST_READY", payload: { pageId: "abc-123" } }

4. CoviWiki responds with COVIWIKI_READY
   { type: "COVIWIKI_READY", payload: { scope: "page", pageId: "abc-123" } }

5. Bidirectional communication established
   ├─ Groupware can send edit mode changes, scroll commands, etc.
   └─ CoviWiki can request page navigation, file preview, etc.
```

## Implementation Details

### Client Side (`use-coviwiki-bridge.ts` — 267 lines)

The bridge hook sets up a `message` event listener that dispatches incoming messages to appropriate handlers:

```typescript
export function useCoviWikiBridge() {
  useEffect(() => {
    const handler = (event: MessageEvent<BridgeMsg>) => {
      switch (event.data.type) {
        case 'REQUEST_READY':
          // Send COVIWIKI_READY back to parent
          break;
        case 'SET_PAGE_EDIT_MODE':
          // Dispatch custom event to editor
          document.dispatchEvent(
            new CustomEvent('COVIWIKI_SET_MODE', { detail: payload })
          );
          break;
        case 'REQUEST_HEADINGS':
          // Extract headings from editor, send to parent
          break;
        // ... other message types
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
}
```

### Editor Integration (`use-coviwiki-editor.ts` — 236 lines)

A separate hook handles editor-specific bridge actions that require access to the TipTap editor instance:

- Scroll to heading by index
- Insert/remove inline comment marks
- Extract heading list from document
- Apply template or history restore content

### Type Safety

All messages are typed via a discriminated union:

```typescript
type BridgeMsg =
  | { type: "REQUEST_READY"; payload: RequestReadyPayload }
  | { type: "SET_PAGE_EDIT_MODE"; payload: PageEditMode }
  | { type: "COVIWIKI_RESTORE_PAGE"; payload: { title: any; content: any } }
  | { type: "REQUEST_HEADINGS" }
  | { type: "SCROLL_TO_HEADING"; payload: number | string }
  // ... etc.
```

### Groupware Side (JavaScript)

The groupware uses three bridge scripts:

| Script | Role |
|--------|------|
| `coviWiki.base.js` | Configuration, iframe URL construction |
| `coviWiki.outbound.js` | Send messages to CoviWiki iframe |
| `coviWiki.inbound.js` | Receive and handle messages from CoviWiki |

Example outbound call:
```javascript
// coviWiki.outbound.js
function setEditMode(mode) {
  wikiIframe.contentWindow.postMessage(
    { type: 'SET_PAGE_EDIT_MODE', payload: mode },
    window.location.origin
  );
}
```

## GW-Specific Routes

CoviWiki includes dedicated route components for groupware integration that strip the default wiki chrome (sidebar, header) and display only the editor content:

| Component | Route | Purpose |
|-----------|-------|---------|
| `use-gw-page-viewer.tsx` | `/gw/page/:pageId` | Page viewer (iframe mode) |
| `use-gw-page-history.tsx` | `/gw/page/:pageId/history` | Page history viewer |
| `use-gw-template-viewer.tsx` | `/gw/template/:key` | Template viewer |
| `use-gw-template-write.tsx` | `/gw/template/:key/write` | Template editor |
| `use-gw-template-history.tsx` | `/gw/template/:key/history` | Template history |
| `use-gw-template-draft.tsx` | `/gw/template/:key/draft` | Template draft |

## GW Mode Detection (`use-gw-mode.ts`)

A lightweight hook detects whether the app is running in groupware mode by checking the URL path:

```typescript
export function useGwMode() {
  return useMemo(() =>
    window.location.pathname.startsWith('/coviwiki/gw/'),
    []
  );
}
```

When in GW mode, the app hides the default sidebar and navigation, relying on the parent groupware for those UI elements.
