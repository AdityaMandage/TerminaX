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

### ISSUE-1: `extension.ts` could benefit from further modularization (611 lines)

**File**: `src/extension.ts`

**Status**: Partially improved (down from 861 to 611 lines), but still contains inline command handlers

**Problem**: The `activate()` function contains many inline command registrations and helper functions. While much better than before, further extraction would improve testability.

**Plan**:
1. Extract broadcast commands into `src/commands/broadcastCommands.ts`.
2. Extract multi-connect / search commands into `src/commands/connectionCommands.ts`.
3. Extract workspace commands into `src/commands/workspaceCommands.ts`.
4. Some helpers already moved to `src/utils/treeHelpers.ts` ✅
5. The `activate()` function should focus on wiring, not implementation.

> [!NOTE]
> Lower priority — significant improvement already made. Consider for v2.0 refactor.

---

### QUALITY-5: `TerminalWorkspaceViewProvider` webview HTML is inline (1555 lines)

**File**: `src/providers/TerminalWorkspaceViewProvider.ts`

**Problem**: The entire webview HTML/CSS/JS is a template literal inside the TypeScript file (getHtml method, lines ~401-1354). This makes it hard to maintain, lacks syntax highlighting, and prevents using CSS/JS linting.

**Plan**:
1. Move the HTML template to a separate file, e.g. `resources/webview/workspace.html`.
2. Load the template at runtime using `vscode.workspace.fs.readFile()`.
3. Use template variables for the nonce, CSP values, and resource URIs.
4. Alternatively, keep inline but extract the CSS and JS into separate methods for readability.

> [!NOTE]
> Deferred — cosmetic improvement with no functional impact. The workspace feature works well.

---

## 🚀 Feature Additions & Enhancements

> [!IMPORTANT]
> **Broadcast Mode** and **Terminal Workspace** are ALREADY IMPLEMENTED but not fully documented in README!

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

### FEAT-3: Implement Command Snippets feature

**Status**: NOT IMPLEMENTED (no code found in codebase)

**Problem**: README mentions command snippets as implemented, but there's no `SnippetManager` or snippet-related code in the project. This feature needs to be built from scratch.

**Plan**:
1. Create `src/models/CommandSnippet.ts` with snippet interface.
2. Create `src/managers/SnippetManager.ts` with CRUD operations.
3. Add snippet storage to `globalState` or separate config.
4. Add commands: `terminax.addSnippet`, `terminax.editSnippet`, `terminax.deleteSnippet`, `terminax.runSnippet`.
5. Add snippet tree view or quick pick UI.
6. Register commands in `package.json`.

> [!NOTE]
> This is a NEW feature, not a fix. Requires full design and implementation.

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

### DOC-1: README "Upcoming Features" is VERY stale and missing major features

**Problem**:
- README lists "Broadcast Mode" as upcoming, but it's FULLY IMPLEMENTED ✅
- README doesn't mention "Terminal Workspace" which is a major feature ✅
- README lists "Command Snippets" as implemented in line 13, but the feature doesn't exist ❌

**Plan**:
1. **URGENT**: Move "Broadcast Mode" from "Upcoming Features" to main "Features" section with proper description
2. **URGENT**: Add "Terminal Workspace" to main "Features" section (webview-based split terminal grid)
3. **FIX**: Remove "Command Snippets" from features OR move to "Upcoming" since it's not implemented
4. Keep SFTP Browser, Port Forwarding, Jump Hosts, Cloud Integration in "Upcoming" (correctly listed as not done)

---

### DOC-2: README missing documentation for major implemented features

**Problem**: Several WORKING features are not documented in README:
- ✅ **Host health checks** - Fully working background TCP probes
- ✅ **Terminal Workspace** - Webview-based split terminal grid (completely missing from README!)
- ✅ **Broadcast Mode** - Listed as upcoming but fully functional
- ✅ **Keyboard shortcuts** - Only mentions Enter/Delete, but HELP.md shows 8 shortcuts
- ✅ **Workspace broadcast** - Independent broadcast per workspace tab

**Plan**:
1. Add "Terminal Workspace" section: explain multi-host grid, broadcast per workspace, copy/paste shortcuts
2. Add "Broadcast Mode" section: explain ClusterSSH-style command broadcasting across sessions
3. Add "Health Checks" section: explain TCP probe feature, settings (enabled/interval/timeout)
4. Expand "Keyboard Shortcuts" section: document all 8 shortcuts from HELP.md
5. Add note about editor vs panel terminal modes

---

### DOC-3: HELP.md file lacks context for new users

**Status**: Low priority - HELP.md is adequate for its purpose

**Problem**: HELP.md jumps straight into commands without explaining what TerminaX is. However, it's primarily accessed from within the extension, so users already know the context.

**Plan**:
1. Add a brief 1-2 sentence intro at the top (optional).
2. Add link to README for full documentation.

> [!NOTE]
> Low priority - current HELP.md serves its purpose well for in-extension reference.

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

**Status**: **CONFIRMED ISSUE** - Mismatch between ESLint (ES6/2015) and tsconfig (ES2020)

**Impact**: ESLint may not properly recognize ES2020 syntax like optional chaining (`?.`), nullish coalescing (`??`), BigInt, etc.

**Plan**:
1. Change `"ecmaVersion": 6` to `"ecmaVersion": 2020` in `.eslintrc.json`.

**Quick Fix**:
```json
{
  "parserOptions": {
    "ecmaVersion": 2020,  // Changed from 6
    "sourceType": "module"
  }
}
```

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

| Category | Remaining | Completed | Notes |
|---|---|---|---|
| 🐛 Bugs | 0 | 7 | All critical bugs fixed ✅ |
| ⚠️ Potential Issues | 0 | 8 | All resolved ✅ |
| 🔧 Code Quality | 1 (deferred) | 5 | Remaining is low priority |
| 🚀 Features | 10 | 0 | Snippets needs implementation from scratch |
| 📄 Documentation | 3 (2 urgent) | 1 | README critically outdated! |
| 🧪 Testing | 2 | 0 | No tests = technical debt |
| 📦 Build & Config | 5 | 0 | ESLint mismatch confirmed |
| **Total** | **21** | **21** | **Major improvement since last review** |

> [!WARNING]
> **CRITICAL**: README lists Broadcast Mode as "upcoming" but it's fully working! Users don't know this feature exists.

> [!WARNING]
> **CRITICAL**: README doesn't mention Terminal Workspace at all - this is a major feature!

---

## 🔒 Security Review - PASSED ✅

**Credential Storage**: Secure
- Uses VSCode `SecretStorage` API (OS keychain)
- Passwords/passphrases never stored in plaintext
- Proper cleanup on host deletion
- No credential leaks in export/logs

**Input Validation**: Good
- Hostname validation includes IPv6 support
- Port range validation (1-65535)
- No command injection vulnerabilities found
- Proper error handling for user input

**No Security Issues Found** ✅

---
