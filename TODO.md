# TerminaX — Full Code Review & TODO

> **Date**: 2026-02-14
> **Scope**: All 20 source files, `package.json`, `tsconfig.json`, `README.md`, `HELP.md`, ESLint config, tests

---

## Table of Contents

1. [⚠️ Remaining Issues](#️-remaining-issues)
2. [🚀 Feature Additions & Enhancements](#-feature-additions--enhancements)
3. [📄 Documentation & README](#-documentation--readme)
4. [🧪 Testing](#-testing)
5. [📦 Build & Config](#-build--config)
6. [✅ Completed Remediations](#-completed-remediations)

---

## ⚠️ Remaining Issues

### ISSUE-1: `extension.ts` is a 861-line monolith

**File**: `src/extension.ts`

**Problem**: The `activate()` function is ~850 lines containing command registrations, helper functions, connection orchestration, and UI logic all inline. This makes it hard to maintain, test, and extend.

**Plan**:
1. Extract broadcast commands into `src/commands/broadcastCommands.ts`.
2. Extract snippet commands into `src/commands/snippetCommands.ts`.
3. Extract multi-connect / search / settings commands into `src/commands/connectionCommands.ts`.
4. Extract shared helpers (`pickHosts`, `connectHosts`, `getTreeSelectionHostIds`, `getAllVisibleNodes`) into `src/utils/treeHelpers.ts`.
5. The `activate()` function should only wire everything together.

> [!NOTE]
> Deferred — this is a large structural refactor with high risk of introducing regressions. Should be done in a dedicated session with thorough testing.

---

### QUALITY-5: `SessionGridViewProvider` webview HTML is inline (561 lines)

**File**: `src/providers/SessionGridViewProvider.ts`

**Problem**: The entire webview HTML/CSS/JS is a template literal inside the TypeScript file. This makes it hard to maintain, lacks syntax highlighting, and prevents using CSS/JS linting.

**Plan**:
1. Move the HTML template to a separate file, e.g. `src/providers/sessionGrid.html`.
2. Load the template at runtime using `vscode.workspace.fs.readFile()`.
3. Use template variables for the nonce and CSP values.
4. Alternatively, keep inline but extract the CSS and JS into separate methods for readability.

> [!NOTE]
> Deferred — cosmetic improvement with no functional impact.

---

## 🚀 Feature Additions & Enhancements

### FEAT-1: Add SSH config file import (`~/.ssh/config`)

**Problem**: Users with existing SSH configs need to manually re-enter all hosts. Most SSH tools support importing from `~/.ssh/config`.

**Plan**:
1. Create `src/utils/sshConfigParser.ts` with a parser for OpenSSH config format.
2. Add a command `terminax.importSSHConfig` that reads `~/.ssh/config`.
3. Parse `Host`, `HostName`, `User`, `Port`, `IdentityFile` directives.
4. Create `SSHHost` entries for each parsed host.
5. Register the command in `package.json`.

---

### FEAT-2: Add "Reconnect" command / auto-reconnect

**Problem**: When a connection drops (red indicator), the user has to double-click to reconnect. There's no "reconnect" action in the context menu, and no auto-reconnect option.

**Plan**:
1. Add a `terminax.reconnect` command that disconnects and re-connects a host.
2. Add an optional `terminax.autoReconnect` setting (`boolean`, default `false`).
3. In `SSHPseudoTerminal.onClientClose()`, if auto-reconnect is enabled and `hasEverConnected` is true, attempt reconnection with exponential backoff (max 3 retries).
4. Add a "Reconnect" option to the host context menu when status is ERROR.

---

### FEAT-3: Add snippet editing support

**Problem**: `SnippetManager` supports `add` and `delete` but not `edit`. Users have to delete and re-create snippets.

**Plan**:
1. Add `update(id: string, updates: Partial<Omit<CommandSnippet, 'id'>>)` to `SnippetManager`.
2. Add a `terminax.editSnippet` command with pre-filled input boxes.
3. Register the command in `package.json`.

---

### FEAT-4: Add connection timeout configuration per host

**Problem**: `readyTimeout` is hardcoded to `30000ms` in `SSHPseudoTerminal.buildSSHConfig()` (line 113). For slow networks or bastion hosts, this might be too low or too high.

**Plan**:
1. Add `readyTimeout?: number` to `SSHConnectionConfig` interface.
2. Add a `terminax.readyTimeout` setting with default `30000`.
3. Use `host.config.readyTimeout ?? extensionConfig.get('readyTimeout', 30000)` in `buildSSHConfig()`.

---

### FEAT-5: Add "Duplicate Host" command

**Problem**: When adding similar hosts (e.g., a cluster of servers), users have to go through the full multi-step prompt for each one.

**Plan**:
1. Add a `terminax.duplicateHost` command.
2. Clone the selected host's config with a new UUID and label suffixed with "(copy)".
3. Register the command in `package.json` and add to hosted context menu.

---

### FEAT-6: Support jump hosts / bastion servers (ProxyCommand / ProxyJump)

**Problem**: Listed as "upcoming" in README. Many enterprise environments require SSH through bastion servers.

**Plan**:
1. Add `jumpHost?: string` and `proxyCommand?: string` to `SSHConnectionConfig`.
2. In `SSHPseudoTerminal.buildSSHConfig()`, if `jumpHost` is set, establish a tunnel via a first-hop `ssh2.Client`, then connect the main client through the tunnel's channel.
3. Update the host configuration prompt to allow selecting a jump host from existing hosts.
4. Add a "Jump Host" option to the auth method step or as a separate step.

---

### FEAT-7: Port forwarding management

**Problem**: Listed as "upcoming" in README. Essential feature for SSH management tools.

**Plan**:
1. Create `src/models/PortForward.ts` with `LocalPortForward` and `RemotePortForward` interfaces.
2. Add `portForwards?: PortForwardConfig[]` to `SSHConnectionConfig`.
3. Create `src/managers/PortForwardManager.ts` to manage forward lifecycle.
4. Add commands: `terminax.addPortForward`, `terminax.removePortForward`, `terminax.listPortForwards`.
5. In `SSHPseudoTerminal.onClientReady()`, set up configured port forwards.

---

### FEAT-8: SFTP file browser panel

**Problem**: Listed as "upcoming" in README. A key MobaXterm feature.

**Plan**:
1. Create `src/providers/SFTPTreeDataProvider.ts` implementing `TreeDataProvider`.
2. Use `ssh2`'s SFTP subsystem (`client.sftp()`) for file operations.
3. Register a new view `terminax-sftp` in the activity bar container.
4. Support basic operations: list, upload, download, delete, rename.
5. Add drag-and-drop support between local and remote files.

---

### FEAT-9: Add host sorting options

**Problem**: Hosts are sorted by `sortOrder` only. Users may want to sort alphabetically, by status, or by health.

**Plan**:
1. Add a `terminax.sortHosts` setting with options: `manual`, `alphabetical`, `status`, `health`.
2. In `SSHTreeDataProvider.getChildren()`, apply the chosen sort after the config sort.
3. Add a toolbar button/command to cycle or pick the sort mode.

---

### FEAT-10: Export/Import should handle credentials optionally

**Problem**: Export currently serializes the raw config without credentials (good for security), but the README mentions "credentials are not exported." There's no option to include them for personal backups.

**Plan**:
1. Add an option in the export dialog: "Include saved credentials?" defaulting to No.
2. If yes, fetch passwords/passphrases from `CredentialService` and include them (encrypted or base64) in the export.
3. On import, detect and store included credentials.
4. Show a security warning when exporting with credentials.

---

## 📄 Documentation & README

### DOC-1: README "Upcoming Features" is stale

**Problem**: README lists "Broadcast Mode" and "Command Snippets" as upcoming, but both are already implemented.

**Plan**:
1. Move "Broadcast Mode" and "Command Snippets" from "Upcoming Features" to the main "Features" section.
2. Update their descriptions to match actual implementation.
3. Keep only truly unimplemented features in "Upcoming".

---

### DOC-2: README doesn't document health checks, session grid, keyboard shortcuts, or terminal modes

**Problem**: Several major implemented features are not mentioned in README:
- Host health checks
- Session Grid view
- Terminal open mode (panel vs editor)
- Multi-connect layout modes
- Full keyboard shortcuts list

**Plan**:
1. Add a "Health Checks" section explaining the TCP probe feature and configuration.
2. Add a "Session Grid" section describing the webview panel.
3. Add terminal mode and layout documentation.
4. Update the keyboard shortcuts section to match the full list in HELP.md.

---

### DOC-3: HELP.md file lacks context for new users

**Problem**: HELP.md jumps straight into commands without explaining what TerminaX is.

**Plan**:
1. Add a brief intro paragraph at the top.
2. Add links to the main README for setup instructions.

---

### DOC-4: No CHANGELOG.md

**Problem**: No changelog to track version history.

**Plan**:
1. Create `CHANGELOG.md` following Keep a Changelog format.
2. Document current features for v0.1.0.

---

## 🧪 Testing

### TEST-1: No automated tests exist

**File**: `src/test/runTest.ts`

**Problem**: The test file is a placeholder that just logs "No automated tests configured". For a tool managing SSH connections and credentials, this is a significant gap.

**Plan**:
1. Set up a proper test framework with `@vscode/test-electron` or `vitest` for unit tests.
2. Priority unit tests to write:
   - `ConfigManager`: add/delete/move nodes, import/export validation, cycle detection
   - `SnippetManager`: CRUD operations
   - `utils/common.ts`: `isValidHostname`, `isValidPort`, `generateUUID`
   - `ConnectionStateTracker`: state transitions
   - `TerminalManager`: terminal tracking, add/remove/lookup
3. Integration tests:
   - Host configuration prompt flow (mock `showInputBox`)
   - Drag-and-drop reordering
   - Health check TCP probing (mock `net.Socket`)

---

### TEST-2: No CI/CD pipeline

**Problem**: No GitHub Actions, GitLab CI, or similar CI configuration.

**Plan**:
1. Create `.github/workflows/ci.yml` with lint, compile, and test steps.
2. Add a build badge to README.

---

## 📦 Build & Config

### BUILD-1: ESLint `ecmaVersion: 6` doesn't match `tsconfig` target `ES2020`

**File**: `.eslintrc.json` (line 5)

**Problem**: ESLint parserOptions sets `ecmaVersion: 6` but `tsconfig.json` targets `ES2020`. This means ESLint may flag valid ES2020 constructs as errors.

**Plan**:
1. Change `ecmaVersion` to `2020` or `11` in `.eslintrc.json`.

---

### BUILD-2: Missing `icon` field in `package.json` for marketplace publishing

**File**: `package.json`

**Problem**: No `icon` property is defined for the extension's marketplace listing. The `resources/icons/terminax.svg` exists for the activity bar, but there's no 128x128 PNG icon for the marketplace.

**Plan**:
1. Create a 128x128 or 256x256 PNG icon for the extension.
2. Add `"icon": "resources/icons/terminax-icon.png"` to `package.json`.

---

### BUILD-3: Missing `repository`, `license`, and `homepage` fields in `package.json`

**File**: `package.json`

**Problem**: These fields are needed for marketplace publishing and open-source best practices.

**Plan**:
1. Add `"repository"`, `"license": "ISC"`, `"homepage"`, and `"bugs"` fields.

---

### BUILD-4: `activationEvents` is empty — relies on implicit activation

**File**: `package.json` (line 13)

**Problem**: An empty `activationEvents` array means VS Code uses implicit activation based on contributed views. This is fine for VSCode ≥ 1.74, but explicitly listing activation events improves clarity.

**Plan**:
1. Add `"onView:terminax-hosts"`, `"onView:terminax-sessions"`, `"onView:terminax-help"` to `activationEvents` for documentation purposes. (Optional — current behavior is correct.)

---

### BUILD-5: No `.vscodeignore` file

**File**: (missing)

**Problem**: Without `.vscodeignore`, `vsce package` will include `node_modules`, `src/`, `.git/`, etc. in the VSIX, making the extension package unnecessarily large.

**Plan**:
1. Create `.vscodeignore` with:
   ```
   .vscode/**
   src/**
   .git/**
   .gitignore
   .eslintrc.json
   tsconfig.json
   node_modules/**
   *.ts
   !out/**
   ```

---

## Summary

| Category | Remaining | Completed |
|---|---|---|
| 🐛 Bugs | 0 | 7 |
| ⚠️ Potential Issues | 1 | 7 |
| 🔧 Code Quality | 1 | 4 (+1 N/A) |
| 🚀 Features | 10 | 0 |
| 📄 Documentation | 4 | 0 |
| 🧪 Testing | 2 | 0 |
| 📦 Build & Config | 5 | 0 |
| **Total** | **23** | **18 (+1 N/A)** |

---

## ✅ Completed Remediations

All items below have been fixed, verified with `tsc --noEmit`, and compile clean.

### BUG-1 ✅ — Broadcast/send on null PTY streams
- **Files changed**: `SSHPseudoTerminal.ts`, `ConnectionManager.ts`
- **Fix**: Added `isStreamActive()` method to `SSHPseudoTerminal`. Guarded `broadcastCommand()`, `sendCommandToHosts()`, and `sendCommandToActiveTerminal()` to only count as "sent" when the PTY stream is actually active.

### BUG-2 ✅ — `SSHFolder.children` orphaned data
- **Files changed**: `SSHFolder.ts`, `ConfigManager.ts`
- **Fix**: Removed the unused `children: string[]` property from `SSHFolder` interface and all construction sites. Child relationships are derived from `parentId` lookups.

### BUG-3 ✅ — `deactivate()` doesn't clean up SSH connections
- **Files changed**: `extension.ts`, `ConnectionManager.ts`
- **Fix**: `ConnectionManager` now implements `vscode.Disposable` and is pushed to `context.subscriptions`. On dispose, it stops broadcast, disposes all terminals, and clears maps.

### BUG-4 ✅ — `onClientClose` missing `cleanup()` call
- **Files changed**: `SSHPseudoTerminal.ts`
- **Fix**: Added `this.cleanup()` at the end of `onClientClose()` to clear stale references when SSH connections drop unexpectedly.

### BUG-5 ✅ — Username cancel defaults to OS user
- **Files changed**: `hostCommands.ts`
- **Fix**: Added `undefined` check after username `showInputBox` to properly detect cancellation (Escape). Also uses `.trim()` for empty-string handling.

### BUG-6 ✅ — `isValidHostname` rejects IPv6
- **Files changed**: `common.ts`
- **Fix**: Added IPv6 address validation with support for standard forms, compressed forms (`::1`), and bracket-wrapped forms (`[::1]`).

### BUG-7 ✅ — `reorderSiblings` misleading async
- **Files changed**: `ConfigManager.ts`
- **Fix**: Removed `async` from `reorderSiblings` signature and `await` from call sites since the function has no actual async operations.

### ISSUE-2 ✅ — `getNodeLocationPath` duplicated 3 times
- **Files changed**: `extension.ts`, `SessionGridViewProvider.ts` + new `treeHelpers.ts`
- **Fix**: Created shared `getNodeLocationPath()` in `src/utils/treeHelpers.ts`. Replaced duplicates in `extension.ts` and `SessionGridViewProvider.ts`. (`SSHTreeDataProvider.getNodePath` retained as it has slightly different semantics — includes current node label.)

### ISSUE-3 ✅ — `formatDuration` duplicated in 2 files
- **Files changed**: `SSHTreeDataProvider.ts`, `SessionGridViewProvider.ts` + `treeHelpers.ts`
- **Fix**: Created shared `formatDuration()` in `src/utils/treeHelpers.ts` with consistent formatting (always includes seconds). Replaced both private implementations.

### ISSUE-4 ✅ — `terminalManager` public but should be encapsulated
- **Files changed**: `ConnectionManager.ts`, `SessionGridViewProvider.ts`
- **Fix**: Changed `terminalManager` to `private`, added `getTerminalCount(hostId)` proxy method. Updated `SessionGridViewProvider` to use the proxy.

### ISSUE-5 ✅ — Import config replaces without backup
- **Files changed**: `ConfigManager.ts`
- **Fix**: `importConfig()` now creates a backup in `globalState` under `terminax.configBackup` before overwriting. Added `restoreConfigBackup()` method for undo support.

### ISSUE-6 ✅ — `checkAllNow` should use `Promise.allSettled`
- **Files changed**: `HealthCheckManager.ts`
- **Fix**: Replaced `Promise.all` with `Promise.allSettled` so a single failing health check doesn't short-circuit the others.

### ISSUE-7 ✅ — Password cancel leaves terminal in limbo
- **Files changed**: `SSHPseudoTerminal.ts`
- **Fix**: When `getPassword()` returns `undefined` (user cancelled), `buildSSHConfig()` now throws `'Password entry cancelled'` which is caught by the error handler, displaying a clear message in the terminal and properly cleaning up.

### ISSUE-8 ✅ — Blocking `readFileSync` for SSH keys
- **Files changed**: `SSHPseudoTerminal.ts`
- **Fix**: Replaced `fs.readFileSync` with `fs.promises.readFile` (async). Changed import to `fs/promises`.

### QUALITY-1 ✅ — `TerminalManager` doesn't implement `Disposable`
- **Files changed**: `TerminalManager.ts`
- **Fix**: Added `vscode.Disposable` implementation with `dispose()` calling `disposeAll()`.

### QUALITY-2 ✅ — `ConnectionManager` events not cleaned up
- **Files changed**: `ConnectionManager.ts`, `extension.ts`
- **Fix**: `ConnectionManager` now implements `vscode.Disposable`. On dispose, it stops broadcast, disposes all terminals, and clears internal maps. Pushed to `context.subscriptions`.

### QUALITY-3 ✅ — No change needed
- **Status**: The structural interface pattern in `SSHTreeDataProvider` is a good decoupling practice. No action required.

### QUALITY-4 ✅ — `void _token` pattern
- **Files changed**: `SSHTreeDataProvider.ts`
- **Fix**: Removed unconventional `void _token;` statements. The underscore prefix already handles suppression.

### QUALITY-6 ✅ — Type narrowing via `as` casts
- **Files changed**: `SSHHost.ts`, `SSHFolder.ts`
- **Fix**: Added `isSSHHost()` and `isSSHFolder()` type guard functions for safe type narrowing. These are now available for use throughout the codebase.
