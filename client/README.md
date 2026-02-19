# Client — Custom Frontend Code

Custom React components, hooks, and extensions built for groupware integration.

## Directory Overview

### `features/editor/hooks/` — Groupware Bridge [NEW]

The communication layer between the wiki editor and the parent groupware iframe.

| File | Lines | Description |
|------|------:|-------------|
| `use-coviwiki-bridge.ts` | 267 | Core bridge hook — `postMessage` listener, message dispatching, page navigation, edit mode control, heading TOC sync |
| `use-coviwiki-editor.ts` | 236 | Editor-specific bridge actions — scroll to heading, inline comment marks, content restore, template application |

### `features/editor/extensions/` — Clipboard Handlers [NEW]

Custom paste handlers for Korean enterprise office formats.

| File | Lines | Description |
|------|------:|-------------|
| `excel-paste-table.ts` | 141 | Detects Excel clipboard data and converts it to TipTap table nodes with proper cell structure |
| `hancom-paste-handler.ts` | 96 | Handles HWP (Hancom Office) paste — parses non-standard clipboard MIME types and maps formatting to editor nodes |

### `hooks/` — Utility Hooks [NEW]

| File | Lines | Description |
|------|------:|-------------|
| `use-gw-mode.ts` | 13 | Detects groupware iframe mode from URL path (`/coviwiki/gw/...`) |
| `use-idle.ts` | 58 | User idle detection — disconnects collaboration after 5 minutes of inactivity, reconnects on tab focus |

### `pages/` — GW Route Components [NEW]

Dedicated route components for groupware integration. These render the editor/viewer without the default wiki chrome (sidebar, header), since the parent groupware provides its own navigation.

**Page routes:**

| File | Lines | Description |
|------|------:|-------------|
| `page/use-gw-page-viewer.tsx` | 20 | Page viewer in iframe mode |
| `page/use-gw-page-history.tsx` | 20 | Page history viewer |

**Template routes:**

| File | Lines | Description |
|------|------:|-------------|
| `template/use-gw-template-viewer.tsx` | 20 | Template viewer |
| `template/use-gw-template-write.tsx` | 20 | Template editor |
| `template/use-gw-template-history.tsx` | 20 | Template history |
| `template/use-gw-template-draft.tsx` | 16 | Template draft |

## Total: 12 files, ~930 lines
