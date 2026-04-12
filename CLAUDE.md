# Pause Browser

Electron + React desktop app. AI browser with chat, email/Discord inbox, and workspace management.

## Architecture

```
src/
├── main.ts           # Electron main process — ALL backend logic lives here
│                       IPC handlers, AI model calls, IMAP/Discord, SQLite DB, settings
├── preload.ts        # IPC bridge (window.browser API) — 40+ methods
├── renderer.tsx      # React entry point
├── App.tsx           # Root component — workspace/tab state via useReducer
├── customTools.ts    # LLM tool definitions (search, bash, remember, etc.)
└── components/
    ├── ChatView.tsx        # Chat interface — streaming, tool calls, model selection
    ├── MessagesView.tsx    # Email/Discord inbox — sync, classify, archive
    ├── NotesView.tsx       # Markdown notes editor with auto-save
    ├── HistoryView.tsx     # Archived workspaces — restore/delete
    ├── TabSidebar.tsx      # Left sidebar — workspace list, pinned Messages/History
    ├── HorizontalTabBar.tsx # Top tab bar — drag reorder, context menu
    ├── Toolbar.tsx         # URL bar with autocomplete
    ├── WebviewContainer.tsx # Webview wrapper for page tabs
    ├── SettingsModal.tsx   # Settings UI — keys, email, discord, memory
    ├── ChatSidebar.tsx     # Quick chat panel
    ├── DownloadBar.tsx     # Download progress
    └── FindBar.tsx         # Find-in-page
```

## Key Concepts

**Workspaces** — vertical sidebar items. Each has tabs (chat, page, messages, notes, history). Messages & History are pinned at top, can't be closed/reordered.

**Tabs** — horizontal. Types: `chat` | `page` | `messages` | `notes` | `history`. Created via reducer actions in App.tsx.

**Sync** — classifies inbox messages via GPT-5.4. Flow:
1. Build 100k raw summary → distill to ~2k digest via gpt-5.4-mini
2. For each UNREAD message: call `categorize-message` with message + digest + Discord context
3. Status: UNREAD → SPAM/TODO/DONE. TODOs create workspaces with notes tabs.

**State** — `useReducer` in App.tsx. Actions: CREATE/CLOSE/SWITCH_WORKSPACE, CREATE/CLOSE/SWITCH_TAB, RESTORE, ENSURE_MESSAGES_WORKSPACE. Persisted to `tabs.json`.

## Data Flow

```
Renderer (React) ←→ preload.ts (IPC bridge) ←→ main.ts (Electron main)
                                                  ├── SQLite (sql.js) — messages.db
                                                  ├── Settings — settings.json
                                                  ├── Notes — notes/{tabId}.md
                                                  ├── Cursors — message-cursors.json
                                                  └── External APIs
                                                       ├── OpenAI (chat, categorize, summarize)
                                                       ├── Anthropic (Claude)
                                                       ├── Google (Gemini)
                                                       ├── IMAP (email)
                                                       ├── Discord API
                                                       └── Brave/Serper (search)
```

## Database (SQLite via sql.js)

**messages** — id, source, time, email_*, discord_*, status, workspace_num, summary
**email_bodies** — uid, subject, sender, recipient, body, html
**custom_messages** — id, time, subject, sender, body
**discord_users** — id → username cache

Status preserved via `ON CONFLICT(id) DO UPDATE SET` (never overwrites status/workspace_num).

## Build

```bash
npm run start     # tsc && esbuild && electron .
./deploy.sh     # electron-builder (macOS DMG)
```

## Important Patterns

- **Settings** are loaded fresh via `loadSettings()` on each request, not cached
- **Discord mentions** `<@ID>` resolved via `discord_users` table + Discord API fallback
- **Popups** handled globally via `app.on('web-contents-created')` — OAuth gets native window, links → new tab
- **Sync dedup** — LLM sees existing workspace names, returns `matchedWorkspaces` for existing tasks
- **Memory** — `selfPrompt` + `memories` in settings, injected into both chat and sync system prompts
- **Workspace closing** archives (sets `archived: true`), doesn't delete. History view shows archived.
