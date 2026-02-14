import * as vscode from 'vscode';
import { ConfigManager } from '../managers/ConfigManager';
import {
  WorkspaceSessionEvent,
  WorkspaceSessionManager
} from '../managers/WorkspaceSessionManager';
import { SSHHost } from '../models/SSHHost';
import { getNodeLocationPath } from '../utils/treeHelpers';

interface WebviewMessage {
  type: string;
  sessionId?: string;
  hostId?: string;
  input?: string;
  text?: string;
  hostIds?: string[];
  columns?: number;
  rows?: number;
}

interface WorkspacePanelCallbacks {
  onDidBecomeActive: (workspaceId: string) => void;
  onDidBroadcastStateChanged: (workspaceId: string, enabled: boolean) => void;
  onDidDispose: (workspaceId: string) => void;
}

/**
 * Standalone webview panel-based terminal workspace.
 */
class WorkspacePanelInstance implements vscode.Disposable {
  private disposed: boolean = false;
  private panel?: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private broadcastEnabled: boolean = false;

  constructor(
    private readonly workspaceId: string,
    private readonly workspaceNumber: number,
    private readonly title: string,
    private readonly extensionUri: vscode.Uri,
    private readonly configManager: ConfigManager,
    private readonly sessionManager: WorkspaceSessionManager,
    private readonly callbacks: WorkspacePanelCallbacks
  ) {
    this.subscriptions.push(
      this.sessionManager.onDidSessionEvent((event) => {
        this.forwardSessionEvent(event);
      })
    );
  }

  async reveal(preserveFocus: boolean = false): Promise<void> {
    const panel = this.ensurePanel();
    panel.reveal(vscode.ViewColumn.Active, preserveFocus);
  }

  getWorkspaceId(): string {
    return this.workspaceId;
  }

  getWorkspaceNumber(): number {
    return this.workspaceNumber;
  }

  isBroadcastEnabled(): boolean {
    return this.broadcastEnabled;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  async connectHosts(hosts: SSHHost[]): Promise<void> {
    if (hosts.length === 0) {
      return;
    }

    await this.reveal(false);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Opening ${hosts.length} workspace session(s)`,
        cancellable: false
      },
      async (progress) => {
        for (let i = 0; i < hosts.length; i++) {
          const host = hosts[i];
          progress.report({ message: `Connecting ${host.label} (${i + 1}/${hosts.length})` });

          try {
            await this.sessionManager.connectHost(host, this.workspaceId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showWarningMessage(
              `Failed to open workspace session for ${host.label}: ${message}`
            );
          }
        }
      }
    );
  }

  async addHostsFromPicker(): Promise<void> {
    await this.reveal(false);
    await this.promptAndConnectHosts();
  }

  disconnectAll(): void {
    this.sessionManager.disconnectAll(this.workspaceId);
  }

  async setBroadcastEnabled(enabled: boolean): Promise<boolean> {
    this.broadcastEnabled = enabled;
    await this.postMessage({
      type: 'broadcastState',
      enabled: this.broadcastEnabled
    });
    this.callbacks.onDidBroadcastStateChanged(this.workspaceId, this.broadcastEnabled);
    return this.broadcastEnabled;
  }

  async toggleBroadcast(): Promise<boolean> {
    return this.setBroadcastEnabled(!this.broadcastEnabled);
  }

  async focusHostSession(hostId: string, sessionId?: string): Promise<boolean> {
    if (sessionId && !this.sessionManager.hasSession(sessionId, this.workspaceId)) {
      return false;
    }

    if (!sessionId && !this.sessionManager.hasHostSessions(hostId, this.workspaceId)) {
      return false;
    }

    await this.reveal(false);
    await this.postMessage({
      type: 'focusSession',
      hostId,
      sessionId
    });

    return true;
  }

  dispose(): void {
    this.disposeInternal(true);
  }

  private disposeInternal(closePanel: boolean): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.sessionManager.disconnectAll(this.workspaceId);

    const currentPanel = this.panel;
    this.panel = undefined;
    if (closePanel) {
      currentPanel?.dispose();
    }

    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;

    this.callbacks.onDidDispose(this.workspaceId);
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.disposed) {
      throw new Error('Workspace panel has been disposed');
    }

    if (this.panel) {
      return this.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      'terminaxWorkspacePanel',
      this.title,
      {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: true
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );

    panel.webview.html = this.getHtml(panel.webview);

    this.subscriptions.push(
      panel.onDidDispose(() => {
        this.disposeInternal(false);
      })
    );

    this.subscriptions.push(
      panel.onDidChangeViewState((event) => {
        if (!event.webviewPanel.active) {
          return;
        }

        this.callbacks.onDidBecomeActive(this.workspaceId);
        this.callbacks.onDidBroadcastStateChanged(this.workspaceId, this.broadcastEnabled);
      })
    );

    this.subscriptions.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleMessage(message).catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          void this.postMessage({
            type: 'toast',
            text: `Workspace action failed: ${text}`
          });
        });
      })
    );

    this.panel = panel;
    return panel;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postMessage({
          type: 'init',
          sessions: this.sessionManager.getAllSessions(this.workspaceId)
        });
        await this.postMessage({
          type: 'broadcastState',
          enabled: this.broadcastEnabled
        });
        break;
      case 'pickHosts':
        await this.promptAndConnectHosts();
        break;
      case 'connectHosts':
        if (message.hostIds && message.hostIds.length > 0) {
          const hosts = message.hostIds
            .map((hostId) => this.configManager.getHost(hostId))
            .filter((host): host is SSHHost => host !== undefined);
          await this.connectHosts(hosts);
        }
        break;
      case 'sendInput':
        if (!message.sessionId || typeof message.input !== 'string') {
          return;
        }

        if (!this.sessionManager.sendInput(message.sessionId, message.input, this.workspaceId)) {
          await this.postMessage({
            type: 'toast',
            text: 'Unable to send input: session no longer exists'
          });
        }
        break;
      case 'broadcastInput':
        if (!message.sessionId || typeof message.input !== 'string') {
          return;
        }

        this.sessionManager.broadcastInput(this.workspaceId, message.sessionId, message.input);
        break;
      case 'requestPaste':
        if (!message.sessionId) {
          return;
        }
        await this.postMessage({
          type: 'deliverPaste',
          sessionId: message.sessionId,
          text: await vscode.env.clipboard.readText()
        });
        break;
      case 'copyText':
        if (typeof message.text !== 'string') {
          return;
        }
        await vscode.env.clipboard.writeText(message.text);
        break;
      case 'resize': {
        if (!message.sessionId) {
          return;
        }

        const columns = this.asFiniteInt(message.columns);
        const rows = this.asFiniteInt(message.rows);
        if (columns === undefined || rows === undefined) {
          return;
        }

        this.sessionManager.resizeSession(message.sessionId, columns, rows, this.workspaceId);
        break;
      }
      case 'disconnectSession':
        if (message.sessionId) {
          this.sessionManager.disconnectSession(message.sessionId, this.workspaceId);
        }
        break;
      case 'disconnectAll':
        this.sessionManager.disconnectAll(this.workspaceId);
        break;
      default:
        break;
    }
  }

  private asFiniteInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    return Math.floor(value);
  }

  private async promptAndConnectHosts(initialHostIds: Set<string> = new Set()): Promise<void> {
    const hosts = this.configManager.getAllVisibleHosts();
    if (hosts.length === 0) {
      vscode.window.showWarningMessage('No hosts configured');
      return;
    }

    const picks = await vscode.window.showQuickPick(
      hosts.map((host) => ({
        label: host.label,
        description: `${host.config.username}@${host.config.host}:${host.config.port}`,
        detail: getNodeLocationPath(host, this.configManager),
        picked: initialHostIds.has(host.id),
        host
      })),
      {
        canPickMany: true,
        ignoreFocusOut: true,
        placeHolder: 'Select hosts for workspace terminals',
        matchOnDescription: true,
        matchOnDetail: true
      }
    );

    if (!picks || picks.length === 0) {
      return;
    }

    await this.connectHosts(picks.map((pick) => pick.host));
  }

  private forwardSessionEvent(event: WorkspaceSessionEvent): void {
    if (!this.panel) {
      return;
    }

    switch (event.type) {
      case 'added':
        if (event.session.workspaceId !== this.workspaceId) {
          return;
        }
        void this.postMessage({ type: 'sessionAdded', session: event.session });
        break;
      case 'updated':
        if (event.session.workspaceId !== this.workspaceId) {
          return;
        }
        void this.postMessage({ type: 'sessionUpdated', session: event.session });
        break;
      case 'output':
        if (event.workspaceId !== this.workspaceId) {
          return;
        }
        void this.postMessage({
          type: 'sessionOutput',
          sessionId: event.sessionId,
          chunk: event.chunk
        });
        break;
      case 'removed':
        if (event.workspaceId !== this.workspaceId) {
          return;
        }
        void this.postMessage({ type: 'sessionRemoved', sessionId: event.sessionId });
        break;
      default:
        break;
    }
  }

  private async postMessage(message: unknown): Promise<void> {
    if (!this.panel) {
      return;
    }

    await this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const xtermCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'xterm', 'css', 'xterm.css')
    );
    const xtermJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', 'xterm', 'lib', 'xterm.js')
    );
    const fitAddonUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js')
    );

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TerminaX Workspace</title>
  <link rel="stylesheet" href="${xtermCssUri}" />
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-terminal-background, #1e1e1e);
      --panel: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #3c3c3c);
      --text: var(--vscode-terminal-foreground, #cccccc);
      --muted: var(--vscode-descriptionForeground, #9d9d9d);
      --ok: var(--vscode-terminal-ansiGreen, #4ec9b0);
      --error: var(--vscode-terminal-ansiRed, #f48771);
      --focus: var(--vscode-focusBorder, #3794ff);
      --font: var(--vscode-editor-font-family, "Cascadia Mono", "Consolas", monospace);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      overflow: hidden;
    }

    .root {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .grid {
      flex: 1;
      min-height: 0;
      padding: 6px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      align-content: stretch;
    }

    .empty {
      border: 1px dashed var(--border);
      color: var(--muted);
      display: grid;
      place-items: center;
      font-size: 12px;
      min-height: 140px;
    }

    .empty.error {
      color: var(--error);
      border-color: var(--error);
    }

    .pane {
      min-width: 0;
      min-height: 220px;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      background: var(--bg);
    }

    .pane.span-all {
      grid-column: 1 / -1;
    }

    .pane:focus-within {
      border-color: var(--focus);
    }

    .pane-header {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      font-size: 11px;
      min-width: 0;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--muted);
    }

    .status-dot.connected {
      background: var(--ok);
    }

    .status-dot.error {
      background: var(--error);
    }

    .host-meta {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 6px;
      overflow: hidden;
    }

    .host-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .host-subtitle {
      color: var(--muted);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
    }

    .status {
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 36%;
    }

    .close-btn {
      width: 20px;
      padding: 0;
      line-height: 18px;
    }

    .terminal-surface {
      flex: 1;
      min-height: 0;
      padding: 2px;
      background: var(--bg);
      overflow: hidden;
    }

    .terminal-surface .xterm,
    .terminal-surface .xterm-screen,
    .terminal-surface .xterm-viewport {
      width: 100%;
      height: 100%;
      background: var(--bg);
    }

    .toast {
      position: fixed;
      right: 12px;
      bottom: 12px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      padding: 8px 10px;
      font-size: 12px;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 0.16s ease, transform 0.16s ease;
      pointer-events: none;
      max-width: min(480px, 70vw);
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <div class="root">
    <div class="grid" id="grid"></div>
  </div>
  <div class="toast" id="toast"></div>

  <script nonce="${nonce}" src="${xtermJsUri}"></script>
  <script nonce="${nonce}" src="${fitAddonUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const sessions = new Map();
    const panes = new Map();
    const MAX_OUTPUT = 250000;
    let workspaceBroadcastEnabled = false;
    const BRACKETED_PASTE_START = '\\u001b[200~';
    const BRACKETED_PASTE_END = '\\u001b[201~';

    const gridEl = document.getElementById('grid');
    const toastEl = document.getElementById('toast');
    const isMacOS = /mac/i.test(navigator.platform);

    const hasTerminalRuntime = typeof Terminal === 'function'
      && typeof FitAddon !== 'undefined'
      && FitAddon
      && typeof FitAddon.FitAddon === 'function';

    const gridObserver = new ResizeObserver(() => {
      updateGridLayout();
      for (const sessionId of panes.keys()) {
        scheduleFit(sessionId);
      }
    });
    gridObserver.observe(gridEl);

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'init':
          hydrateSessions(message.sessions || []);
          break;
        case 'sessionAdded':
          if (!message.session || !message.session.id) {
            return;
          }
          upsertSession(message.session);
          ensurePane(message.session.id, true);
          break;
        case 'sessionUpdated':
          if (!message.session || !message.session.id) {
            return;
          }
          upsertSession(message.session);
          updatePaneHeader(message.session.id);
          break;
        case 'sessionOutput':
          appendOutput(message.sessionId, message.chunk || '');
          break;
        case 'sessionRemoved':
          removeSession(message.sessionId);
          break;
        case 'focusSession':
          focusSession(message.hostId, message.sessionId);
          break;
        case 'broadcastState': {
          const nextEnabled = Boolean(message.enabled);
          if (workspaceBroadcastEnabled !== nextEnabled) {
            workspaceBroadcastEnabled = nextEnabled;
            showToast(nextEnabled ? 'Workspace broadcast enabled' : 'Workspace broadcast disabled');
          }
          break;
        }
        case 'deliverPaste':
          if (!message.sessionId || typeof message.text !== 'string') {
            return;
          }
          sendUserInput(message.sessionId, message.text, true);
          break;
        case 'toast':
          showToast(message.text || 'Notice');
          break;
        default:
          break;
      }
    });

    if (!hasTerminalRuntime) {
      renderRuntimeError('Terminal engine failed to initialize. Reload the window to retry.');
      showToast('Terminal runtime missing');
    } else {
      renderEmptyState();
    }

    vscode.postMessage({ type: 'ready' });

    function sendUserInput(sessionId, input, fromPaste = false) {
      if (!sessionId || typeof input !== 'string' || input.length === 0) {
        return;
      }

      const payload = fromPaste && hasMultipleLines(input)
        ? wrapBracketedPaste(input)
        : input;

      const CHUNK_SIZE = 32000;
      for (let index = 0; index < payload.length; index += CHUNK_SIZE) {
        const chunk = payload.slice(index, index + CHUNK_SIZE);
        vscode.postMessage({
          type: 'sendInput',
          sessionId,
          input: chunk
        });

        if (workspaceBroadcastEnabled) {
          vscode.postMessage({
            type: 'broadcastInput',
            sessionId,
            input: chunk
          });
        }
      }
    }

    function hasMultipleLines(text) {
      return text.includes('\\n') || text.includes('\\r');
    }

    function wrapBracketedPaste(text) {
      return BRACKETED_PASTE_START + text + BRACKETED_PASTE_END;
    }

    function copySelection(term) {
      const selectedText = term.getSelection();
      if (!selectedText) {
        return false;
      }

      vscode.postMessage({
        type: 'copyText',
        text: selectedText
      });
      showToast('Copied');
      return true;
    }

    function isCopyShortcut(event) {
      const key = event.key.toLowerCase();
      if (key === 'insert') {
        return event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
      }

      if (key !== 'c') {
        return false;
      }

      if (isMacOS) {
        return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      }

      return event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
    }

    function isSelectionCopyShortcut(event, term) {
      if (!term.hasSelection() || event.key.toLowerCase() !== 'c') {
        return false;
      }

      if (isMacOS) {
        return event.metaKey && !event.ctrlKey && !event.altKey;
      }

      return event.ctrlKey && !event.altKey && !event.metaKey;
    }

    function isPasteShortcut(event) {
      const key = event.key.toLowerCase();
      if (key === 'insert') {
        return event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
      }

      if (key !== 'v') {
        return false;
      }

      if (isMacOS) {
        return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      }

      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
        return true;
      }

      return event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
    }

    function handleCustomKeyEvent(event, sessionId, term) {
      if (event.type !== 'keydown') {
        return true;
      }

      if (isSelectionCopyShortcut(event, term)) {
        event.preventDefault();
        copySelection(term);
        return false;
      }

      if (isPasteShortcut(event)) {
        event.preventDefault();
        vscode.postMessage({
          type: 'requestPaste',
          sessionId
        });
        return false;
      }

      if (isCopyShortcut(event) && term.hasSelection()) {
        event.preventDefault();
        copySelection(term);
        return false;
      }

      return true;
    }

    function hydrateSessions(nextSessions) {
      for (const sessionId of Array.from(panes.keys())) {
        if (!nextSessions.find((item) => item && item.id === sessionId)) {
          disposePane(sessionId);
        }
      }

      sessions.clear();
      for (const session of nextSessions) {
        if (!session || !session.id) {
          continue;
        }

        const normalized = normalizeSession(session);
        sessions.set(normalized.id, normalized);
      }

      if (!hasTerminalRuntime) {
        return;
      }

      if (sessions.size === 0) {
        renderEmptyState();
        return;
      }

      removeEmptyState();
      for (const session of getSortedSessions()) {
        ensurePane(session.id, false);
      }
      reorderPaneRoots();
      updateGridLayout();
    }

    function upsertSession(rawSession) {
      const existing = sessions.get(rawSession.id) || {};
      const merged = normalizeSession({ ...existing, ...rawSession });
      sessions.set(merged.id, merged);

      if (hasTerminalRuntime) {
        removeEmptyState();
      }
    }

    function normalizeSession(session) {
      return {
        id: session.id,
        hostId: session.hostId,
        hostLabel: session.hostLabel,
        hostSubtitle: session.hostSubtitle,
        status: session.status,
        createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(),
        output: typeof session.output === 'string' ? session.output : '',
        lastError: typeof session.lastError === 'string' ? session.lastError : undefined
      };
    }

    function appendOutput(sessionId, chunk) {
      if (!sessionId || !chunk) {
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }

      session.output = trimOutput((session.output || '') + chunk);

      if (!hasTerminalRuntime) {
        return;
      }

      const pane = panes.get(sessionId);
      if (!pane) {
        ensurePane(sessionId, false);
        return;
      }

      pane.term.write(chunk);
    }

    function trimOutput(output) {
      if (output.length <= MAX_OUTPUT) {
        return output;
      }

      return output.slice(output.length - MAX_OUTPUT);
    }

    function removeSession(sessionId) {
      if (!sessionId) {
        return;
      }

      sessions.delete(sessionId);
      disposePane(sessionId);

      if (!hasTerminalRuntime) {
        return;
      }

      if (sessions.size === 0) {
        renderEmptyState();
        return;
      }

      reorderPaneRoots();
      updateGridLayout();
    }

    function ensurePane(sessionId, focusOnCreate) {
      if (!hasTerminalRuntime) {
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }

      let pane = panes.get(sessionId);
      if (!pane) {
        pane = createPane(session);
        panes.set(sessionId, pane);
      }

      updatePaneHeader(sessionId);

      if (!pane.hasHydratedOutput && session.output) {
        pane.term.write(session.output);
      }
      pane.hasHydratedOutput = true;

      scheduleFit(sessionId);

      if (focusOnCreate) {
        pane.term.focus();
      }

      reorderPaneRoots();
      updateGridLayout();
    }

    function createPane(session) {
      const root = document.createElement('section');
      root.className = 'pane';

      const header = document.createElement('div');
      header.className = 'pane-header';

      const dot = document.createElement('span');
      dot.className = 'status-dot';

      const hostMeta = document.createElement('div');
      hostMeta.className = 'host-meta';

      const hostLabel = document.createElement('span');
      hostLabel.className = 'host-label';

      const hostSubtitle = document.createElement('span');
      hostSubtitle.className = 'host-subtitle';

      hostMeta.append(hostLabel, hostSubtitle);

      const status = document.createElement('span');
      status.className = 'status';

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'close-btn';
      closeBtn.title = 'Disconnect session';
      closeBtn.textContent = 'x';
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        vscode.postMessage({
          type: 'disconnectSession',
          sessionId: session.id
        });
      });

      header.append(dot, hostMeta, status, closeBtn);

      const terminalSurface = document.createElement('div');
      terminalSurface.className = 'terminal-surface';

      root.append(header, terminalSurface);
      gridEl.appendChild(root);

      const term = new Terminal({
        allowTransparency: false,
        convertEol: false,
        cursorBlink: true,
        drawBoldTextInBrightColors: true,
        fontFamily: readCss('--vscode-terminal-font-family', readCss('--vscode-editor-font-family', 'monospace')),
        fontSize: parseInt(readCss('--vscode-terminal-font-size', '13'), 10) || 13,
        lineHeight: 1.15,
        scrollback: 5000,
        theme: buildTerminalTheme()
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalSurface);
      term.attachCustomKeyEventHandler((event) => handleCustomKeyEvent(event, session.id, term));

      const terminalDisposables = [
        term.onData((data) => {
          sendUserInput(session.id, data);
        }),
        term.onResize((size) => {
          postResize(session.id, size.cols, size.rows);
        })
      ];

      const pane = {
        root,
        dot,
        hostLabel,
        hostSubtitle,
        status,
        term,
        fitAddon,
        resizeObserver: new ResizeObserver(() => {
          scheduleFit(session.id);
        }),
        terminalDisposables,
        fitRaf: undefined,
        lastResize: '',
        hasHydratedOutput: false
      };

      pane.resizeObserver.observe(terminalSurface);

      const focusTerminalSoon = () => {
        setTimeout(() => {
          term.focus();
        }, 0);
      };
      root.addEventListener('mousedown', () => {
        focusTerminalSoon();
      });
      header.addEventListener('pointerdown', () => {
        focusTerminalSoon();
      });
      terminalSurface.addEventListener('pointerdown', () => {
        focusTerminalSoon();
      });
      terminalSurface.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (copySelection(term)) {
          return;
        }

        vscode.postMessage({
          type: 'requestPaste',
          sessionId: session.id
        });
      });

      return pane;
    }

    function scheduleFit(sessionId) {
      const pane = panes.get(sessionId);
      if (!pane) {
        return;
      }

      if (pane.fitRaf !== undefined) {
        cancelAnimationFrame(pane.fitRaf);
      }

      pane.fitRaf = requestAnimationFrame(() => {
        pane.fitRaf = undefined;
        try {
          pane.fitAddon.fit();
        } catch {
          return;
        }

        postResize(sessionId, pane.term.cols, pane.term.rows);
      });
    }

    function postResize(sessionId, columns, rows) {
      const pane = panes.get(sessionId);
      if (!pane) {
        return;
      }

      const safeColumns = Math.max(2, Math.floor(columns || 0));
      const safeRows = Math.max(1, Math.floor(rows || 0));
      const resizeKey = safeColumns + 'x' + safeRows;
      if (pane.lastResize === resizeKey) {
        return;
      }

      pane.lastResize = resizeKey;
      vscode.postMessage({
        type: 'resize',
        sessionId,
        columns: safeColumns,
        rows: safeRows
      });
    }

    function updatePaneHeader(sessionId) {
      const session = sessions.get(sessionId);
      const pane = panes.get(sessionId);
      if (!session || !pane) {
        return;
      }

      pane.hostLabel.textContent = session.hostLabel;
      pane.hostSubtitle.textContent = session.hostSubtitle;
      pane.status.textContent = formatStatus(session);
      pane.dot.className = 'status-dot ' + statusClass(session.status);
    }

    function focusSession(hostId, sessionId) {
      let targetSessionId = null;
      if (sessionId && panes.has(sessionId)) {
        targetSessionId = sessionId;
      }

      if (!targetSessionId && hostId) {
        const match = getSortedSessions().find((session) => session.hostId === hostId);
        targetSessionId = match ? match.id : null;
      }

      if (!targetSessionId) {
        return;
      }

      const pane = panes.get(targetSessionId);
      if (!pane) {
        return;
      }

      pane.root.scrollIntoView({ block: 'nearest' });
      pane.term.focus();
    }

    function statusClass(status) {
      if (status === 'connected') {
        return 'connected';
      }

      if (status === 'error') {
        return 'error';
      }

      return '';
    }

    function formatStatus(session) {
      if (session.status === 'connected') {
        return 'connected';
      }

      if (session.status === 'error') {
        return session.lastError ? 'error: ' + session.lastError : 'error';
      }

      return 'disconnected';
    }

    function reorderPaneRoots() {
      if (sessions.size === 0) {
        return;
      }

      const ordered = getSortedSessions();
      for (const session of ordered) {
        const pane = panes.get(session.id);
        if (!pane) {
          continue;
        }

        pane.root.classList.remove('span-all');
        gridEl.appendChild(pane.root);
      }
    }

    function updateGridLayout() {
      const count = panes.size;
      if (count <= 0) {
        gridEl.style.gridTemplateColumns = '1fr';
        return;
      }

      let columns = 1;
      if (count === 2) {
        columns = 2;
      } else if (count >= 3 && count <= 4) {
        columns = 2;
      } else if (count >= 5) {
        columns = 3;
      }

      gridEl.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(300px, 1fr))';

      const ordered = getSortedSessions();
      for (const session of ordered) {
        const pane = panes.get(session.id);
        if (pane) {
          pane.root.classList.remove('span-all');
        }
      }

      if (count > 2 && count % columns === 1) {
        const last = ordered[ordered.length - 1];
        if (last) {
          const pane = panes.get(last.id);
          if (pane) {
            pane.root.classList.add('span-all');
          }
        }
      }
    }

    function getSortedSessions() {
      return Array.from(sessions.values()).sort((a, b) => a.createdAt - b.createdAt);
    }

    function disposePane(sessionId) {
      const pane = panes.get(sessionId);
      if (!pane) {
        return;
      }

      pane.resizeObserver.disconnect();

      if (pane.fitRaf !== undefined) {
        cancelAnimationFrame(pane.fitRaf);
      }

      for (const disposable of pane.terminalDisposables) {
        disposable.dispose();
      }

      pane.term.dispose();
      pane.root.remove();
      panes.delete(sessionId);
    }

    function removeEmptyState() {
      const empty = gridEl.querySelector('.empty');
      if (empty) {
        empty.remove();
      }
    }

    function renderEmptyState() {
      for (const sessionId of Array.from(panes.keys())) {
        disposePane(sessionId);
      }

      gridEl.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No active sessions. Use "TerminaX: Workspace Add Hosts" to open split terminals.';
      gridEl.appendChild(empty);
      updateGridLayout();
    }

    function renderRuntimeError(message) {
      for (const sessionId of Array.from(panes.keys())) {
        disposePane(sessionId);
      }

      gridEl.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty error';
      empty.textContent = message;
      gridEl.appendChild(empty);
      updateGridLayout();
    }

    function readCss(name, fallback) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    }

    function buildTerminalTheme() {
      return {
        background: readCss('--vscode-terminal-background', '#1e1e1e'),
        foreground: readCss('--vscode-terminal-foreground', '#cccccc'),
        cursor: readCss('--vscode-terminalCursor-foreground', '#cccccc'),
        cursorAccent: readCss('--vscode-terminalCursor-background', '#1e1e1e'),
        selectionBackground: readCss('--vscode-terminal-selectionBackground', '#264f78'),
        black: readCss('--vscode-terminal-ansiBlack', '#000000'),
        red: readCss('--vscode-terminal-ansiRed', '#cd3131'),
        green: readCss('--vscode-terminal-ansiGreen', '#0dbc79'),
        yellow: readCss('--vscode-terminal-ansiYellow', '#e5e510'),
        blue: readCss('--vscode-terminal-ansiBlue', '#2472c8'),
        magenta: readCss('--vscode-terminal-ansiMagenta', '#bc3fbc'),
        cyan: readCss('--vscode-terminal-ansiCyan', '#11a8cd'),
        white: readCss('--vscode-terminal-ansiWhite', '#e5e5e5'),
        brightBlack: readCss('--vscode-terminal-ansiBrightBlack', '#666666'),
        brightRed: readCss('--vscode-terminal-ansiBrightRed', '#f14c4c'),
        brightGreen: readCss('--vscode-terminal-ansiBrightGreen', '#23d18b'),
        brightYellow: readCss('--vscode-terminal-ansiBrightYellow', '#f5f543'),
        brightBlue: readCss('--vscode-terminal-ansiBrightBlue', '#3b8eea'),
        brightMagenta: readCss('--vscode-terminal-ansiBrightMagenta', '#d670d6'),
        brightCyan: readCss('--vscode-terminal-ansiBrightCyan', '#29b8db'),
        brightWhite: readCss('--vscode-terminal-ansiBrightWhite', '#e5e5e5')
      };
    }

    let toastTimer;
    function showToast(text) {
      clearTimeout(toastTimer);
      toastEl.textContent = text;
      toastEl.classList.add('show');
      toastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
      }, 900);
    }
  </script>
</body>
</html>`;
  }
}

/**
 * Manages multiple workspace webview panels.
 */
export class TerminalWorkspacePanel implements vscode.Disposable {
  private readonly workspaces = new Map<string, WorkspacePanelInstance>();
  private activeWorkspaceId?: string;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configManager: ConfigManager,
    private readonly sessionManager: WorkspaceSessionManager
  ) { }

  async reveal(preserveFocus: boolean = false): Promise<void> {
    const workspace = this.getActiveWorkspace() || this.createWorkspace();
    await workspace.reveal(preserveFocus);
  }

  async openWorkspace(preserveFocus: boolean = false): Promise<void> {
    const workspace = this.createWorkspace();
    await workspace.reveal(preserveFocus);
  }

  async connectHosts(hosts: SSHHost[]): Promise<void> {
    if (hosts.length === 0) {
      return;
    }

    const workspace = this.getActiveWorkspace() || this.createWorkspace();
    await workspace.connectHosts(hosts);
  }

  async addHostsFromPicker(): Promise<void> {
    const workspace = this.getActiveWorkspace() || this.createWorkspace();
    await workspace.addHostsFromPicker();
  }

  disconnectAll(): void {
    const workspace = this.getActiveWorkspace();
    if (!workspace) {
      return;
    }

    workspace.disconnectAll();
  }

  async setBroadcastEnabled(enabled: boolean): Promise<boolean> {
    const workspace = this.getActiveWorkspace();
    if (!workspace) {
      return false;
    }

    return workspace.setBroadcastEnabled(enabled);
  }

  async toggleBroadcast(): Promise<boolean> {
    const workspace = this.getActiveWorkspace();
    if (!workspace) {
      return false;
    }

    return workspace.toggleBroadcast();
  }

  isBroadcastEnabled(): boolean {
    return this.getActiveWorkspace()?.isBroadcastEnabled() ?? false;
  }

  hasActiveWorkspace(): boolean {
    return this.getActiveWorkspace() !== undefined;
  }

  async focusHostSession(hostId: string, sessionId?: string): Promise<boolean> {
    const workspace = this.findWorkspaceForFocus(hostId, sessionId);
    if (!workspace) {
      return false;
    }

    return workspace.focusHostSession(hostId, sessionId);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    const snapshots = Array.from(this.workspaces.values());
    this.workspaces.clear();
    for (const workspace of snapshots) {
      workspace.dispose();
    }

    this.activeWorkspaceId = undefined;
    void vscode.commands.executeCommand('setContext', 'terminax.workspaceBroadcastActive', false);
  }

  private createWorkspace(): WorkspacePanelInstance {
    const workspaceNumber = this.getNextWorkspaceNumber();
    const workspaceId = `workspace-${workspaceNumber}-${Date.now()}`;
    const title = workspaceNumber === 1
      ? 'TerminaX Workspace'
      : `TerminaX Workspace ${workspaceNumber}`;

    const workspace = new WorkspacePanelInstance(
      workspaceId,
      workspaceNumber,
      title,
      this.extensionUri,
      this.configManager,
      this.sessionManager,
      {
        onDidBecomeActive: (id) => {
          this.activeWorkspaceId = id;
          const activeWorkspace = this.workspaces.get(id);
          void this.updateBroadcastContext(activeWorkspace?.isBroadcastEnabled() ?? false);
        },
        onDidBroadcastStateChanged: (id, enabled) => {
          if (this.activeWorkspaceId === id) {
            void this.updateBroadcastContext(enabled);
          }
        },
        onDidDispose: (id) => {
          this.workspaces.delete(id);

          if (this.activeWorkspaceId === id) {
            this.activeWorkspaceId = this.getActiveWorkspace()?.getWorkspaceId();
            void this.updateBroadcastContext(this.isBroadcastEnabled());
          }
        }
      }
    );

    this.workspaces.set(workspaceId, workspace);
    this.activeWorkspaceId = workspaceId;
    void this.updateBroadcastContext(workspace.isBroadcastEnabled());
    return workspace;
  }

  private getActiveWorkspace(): WorkspacePanelInstance | undefined {
    if (this.activeWorkspaceId) {
      const activeWorkspace = this.workspaces.get(this.activeWorkspaceId);
      if (activeWorkspace && !activeWorkspace.isDisposed()) {
        return activeWorkspace;
      }
    }

    for (const workspace of this.workspaces.values()) {
      if (!workspace.isDisposed()) {
        return workspace;
      }
    }

    return undefined;
  }

  private getNextWorkspaceNumber(): number {
    const usedNumbers = new Set<number>(
      Array.from(this.workspaces.values()).map((workspace) => workspace.getWorkspaceNumber())
    );

    let candidate = 1;
    while (usedNumbers.has(candidate)) {
      candidate += 1;
    }

    return candidate;
  }

  private findWorkspaceForFocus(hostId: string, sessionId?: string): WorkspacePanelInstance | undefined {
    if (sessionId) {
      const workspaceId = this.sessionManager.getSessionWorkspaceId(sessionId);
      return workspaceId ? this.workspaces.get(workspaceId) : undefined;
    }

    const workspaceId = this.sessionManager.findWorkspaceWithHostSession(hostId);
    if (workspaceId) {
      return this.workspaces.get(workspaceId);
    }

    return this.getActiveWorkspace();
  }

  private async updateBroadcastContext(enabled: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'terminax.workspaceBroadcastActive', enabled);
  }
}

function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
