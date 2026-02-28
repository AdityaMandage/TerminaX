import * as vscode from 'vscode';
import { SSHHost } from '../models/SSHHost';
import {
  ConnectionMetadata,
  ConnectionStatus,
  ConnectionStateTracker
} from '../models/ConnectionState';
import { SSHPseudoTerminal } from '../providers/SSHPseudoTerminal';
import { TerminalInfo, TerminalManager } from './TerminalManager';
import { CredentialService } from '../services/CredentialService';
import { SSHTreeDataProvider } from '../providers/SSHTreeDataProvider';

export interface SessionSnapshot {
  terminalId: string;
  hostId: string;
  status: ConnectionStatus;
  createdAt: Date;
}

/**
 * Manages SSH connections and their lifecycle
 */
export class ConnectionManager implements vscode.Disposable {
  private terminalManager: TerminalManager;
  private stateTracker: ConnectionStateTracker;
  private treeProvider?: SSHTreeDataProvider;
  private terminalStatuses: Map<string, ConnectionStatus> = new Map();
  private hostLastError: Map<string, string> = new Map();
  private broadcastHostIds: Set<string> = new Set();
  private broadcastActive: boolean = false;
  private onDidChangeSessionsEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSessions = this.onDidChangeSessionsEmitter.event;

  constructor(
    private context: vscode.ExtensionContext,
    private credentialService: CredentialService,
    treeProvider?: SSHTreeDataProvider
  ) {
    this.terminalManager = new TerminalManager();
    this.stateTracker = new ConnectionStateTracker();
    this.treeProvider = treeProvider;
    context.subscriptions.push(this.onDidChangeSessionsEmitter);

    // Listen to terminal lifecycle events
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal(terminal => {
        this.handleTerminalClose(terminal);
      })
    );
  }

  dispose(): void {
    this.stopBroadcast();
    this.terminalManager.dispose();
    this.terminalStatuses.clear();
    this.hostLastError.clear();
    this.stateTracker.clearAll();
  }

  /**
   * Get the number of active terminals for a specific host
   */
  getTerminalCount(hostId: string): number {
    return this.terminalManager.getTerminalCount(hostId);
  }

  /**
   * Get lightweight session metadata for tree rendering
   */
  getSessionInfos(hostId: string): Array<{
    terminalId: string;
    hostId: string;
    createdAt: Date;
    status: ConnectionStatus;
  }> {
    return this.terminalManager.getTerminalInfosByHost(hostId).map(info => ({
      terminalId: info.terminalId,
      hostId: info.hostId,
      createdAt: info.createdAt,
      status: this.terminalStatuses.get(info.terminalId) || ConnectionStatus.DISCONNECTED
    }));
  }

  /**
   * Set tree provider after construction (avoids circular dependency hacks)
   */
  setTreeProvider(treeProvider: SSHTreeDataProvider): void {
    this.treeProvider = treeProvider;
  }

  /**
   * Connect to an SSH host
   */
  async connect(
    host: SSHHost,
    splitTerminal: boolean = false,
    splitParentTerminal?: vscode.Terminal,
    openModeOverride?: 'panel' | 'editor'
  ): Promise<vscode.Terminal | undefined> {
    try {
      const terminalOpenMode = openModeOverride || 'editor';

      // Generate unique terminal ID
      const terminalId = `terminax-${host.id}-${Date.now()}`;

      // Create pseudoterminal with status callback
      const pty = new SSHPseudoTerminal(
        host,
        this.credentialService,
        terminalId,
        (status, metadata) => {
          this.handleStatusUpdate(host.id, terminalId, status, metadata);
        },
        {
          closeOnCleanExit: false
        }
      );

      // Create VSCode terminal with optional split location
      const terminalOptions: vscode.ExtensionTerminalOptions = {
        name: `SSH: ${host.label}`,
        pty,
        iconPath: new vscode.ThemeIcon('server'),
        location:
          terminalOpenMode === 'editor'
            ? vscode.TerminalLocation.Editor
            : vscode.TerminalLocation.Panel
      };
      let hasSplitParentLocation = false;

      // If split terminal, create it beside the active terminal
      if (
        splitTerminal &&
        terminalOpenMode === 'panel'
      ) {
        const parentTerminal = splitParentTerminal || vscode.window.activeTerminal;
        if (parentTerminal) {
          // Make the intended split parent active first for more reliable split placement.
          parentTerminal.show(true);
          await vscode.commands.executeCommand('workbench.action.terminal.focus');

          terminalOptions.location = {
            parentTerminal: vscode.window.activeTerminal || parentTerminal
          };
          hasSplitParentLocation = true;
        }
      }

      if (splitTerminal && terminalOpenMode === 'panel' && !hasSplitParentLocation) {
        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
          terminalOptions.location = {
            parentTerminal: activeTerminal
          };
          hasSplitParentLocation = true;
        }
      }

      const terminal = vscode.window.createTerminal(terminalOptions);

      // Register with terminal manager
      this.terminalManager.addTerminal(terminalId, terminal, host.id, pty);
      this.terminalStatuses.set(terminalId, ConnectionStatus.DISCONNECTED);
      this.recomputeHostState(host.id);
      this.emitSessionChange();

      // Show terminal and bring to focus
      terminal.show(false);

      // For non-split, bring panel to focus and maximize workspace area
      if (!splitTerminal && terminalOpenMode === 'panel') {
        await this.focusAndMaximizeTerminalPanel();
      }

      return terminal;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to connect to ${host.label}: ${error}`
      );
      return undefined;
    }
  }

  /**
   * Disconnect from a host (closes all terminals for that host)
   */
  disconnect(hostId: string): void {
    this.terminalManager.disposeHostTerminals(hostId);
    this.emitSessionChange();
  }

  /**
   * Handle status updates from pseudoterminal
   */
  private handleStatusUpdate(
    hostId: string,
    terminalId: string,
    status: ConnectionStatus,
    metadata?: ConnectionMetadata
  ): void {
    this.terminalStatuses.set(terminalId, status);

    if (metadata?.error) {
      this.hostLastError.set(hostId, metadata.error);
    }

    this.recomputeHostState(hostId);
    this.emitSessionChange();
  }

  /**
   * Handle terminal close event
   */
  private handleTerminalClose(terminal: vscode.Terminal): void {
    const terminalId = this.terminalManager.getTerminalId(terminal);
    if (terminalId) {
      const info = this.terminalManager.getTerminalInfo(terminalId);
      if (info) {
        this.terminalStatuses.delete(terminalId);
        this.terminalManager.removeTerminal(terminalId);
        this.recomputeHostState(info.hostId);
        this.emitSessionChange();
      }
    }
  }

  /**
   * Recompute host-level state from all active terminal sessions
   */
  private recomputeHostState(hostId: string): void {
    const terminalIds = this.terminalManager.getTerminalIdsByHost(hostId);

    if (terminalIds.length === 0) {
      this.stateTracker.updateState(hostId, ConnectionStatus.DISCONNECTED, {
        terminalId: null
      });
      this.hostLastError.delete(hostId);
      this.refreshTree();
      return;
    }

    const statuses = terminalIds.map(
      terminalId => this.terminalStatuses.get(terminalId) || ConnectionStatus.DISCONNECTED
    );

    const connectedTerminalId = terminalIds.find(
      terminalId => this.terminalStatuses.get(terminalId) === ConnectionStatus.CONNECTED
    );

    if (connectedTerminalId) {
      this.stateTracker.updateState(hostId, ConnectionStatus.CONNECTED, {
        terminalId: connectedTerminalId
      });
      this.refreshTree();
      return;
    }

    if (statuses.includes(ConnectionStatus.ERROR)) {
      this.stateTracker.updateState(hostId, ConnectionStatus.ERROR, {
        terminalId: terminalIds[0],
        error: this.hostLastError.get(hostId) || 'Connection error'
      });
      this.refreshTree();
      return;
    }

    this.stateTracker.updateState(hostId, ConnectionStatus.DISCONNECTED, {
      terminalId: terminalIds[0]
    });
    this.refreshTree();
  }

  /**
   * Focus and maximize terminal panel for better default visibility
   */
  private async focusAndMaximizeTerminalPanel(): Promise<boolean> {
    try {
      await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    } catch {
      // Keep going if panel positioning command is unavailable.
    }
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
    } catch {
      // Focus command should be present, but avoid failing connection setup on command errors.
    }

    // Prefer non-toggle maximize command so behavior is deterministic per connect.
    try {
      await vscode.commands.executeCommand('workbench.action.maximizePanel');
      return true;
    } catch {
      // Fallback for VSCode builds that only expose toggle.
      try {
        await vscode.commands.executeCommand('workbench.action.toggleMaximizedPanel');
        return true;
      } catch {
        // Keep focus behavior only if maximize command is unavailable.
      }
    }

    return false;
  }

  /**
   * Ensure panel is focused and maximized (best effort)
   */
  async ensurePanelMaximized(): Promise<boolean> {
    return this.focusAndMaximizeTerminalPanel();
  }

  private refreshTree(): void {
    this.treeProvider?.refresh();
  }

  /**
   * Enable broadcast mode for a set of hosts
   */
  startBroadcast(hostIds: string[]): number {
    this.broadcastHostIds = new Set(hostIds);
    this.broadcastActive = this.broadcastHostIds.size > 0;
    this.emitSessionChange();
    return this.broadcastHostIds.size;
  }

  /**
   * Disable broadcast mode
   */
  stopBroadcast(): void {
    this.broadcastHostIds.clear();
    this.broadcastActive = false;
    this.emitSessionChange();
  }

  /**
   * Check whether broadcast mode is active
   */
  isBroadcastActive(): boolean {
    return this.broadcastActive;
  }

  /**
   * Send a command to all active terminals in broadcast scope
   */
  broadcastCommand(command: string): { sent: number } {
    if (!this.broadcastActive || this.broadcastHostIds.size === 0) {
      return { sent: 0 };
    }

    const payload = command.endsWith('\n') ? command : `${command}\n`;
    let sent = 0;

    for (const hostId of this.broadcastHostIds) {
      const terminals = this.terminalManager.getTerminalInfosByHost(hostId);
      for (const terminalInfo of terminals) {
        if (terminalInfo.pty.isStreamActive()) {
          terminalInfo.pty.handleInput(payload);
          sent += 1;
        }
      }
    }

    return { sent };
  }

  /**
   * Send a command to tracked sessions for selected hosts
   */
  sendCommandToHosts(hostIds: string[], command: string): { sent: number } {
    if (hostIds.length === 0) {
      return { sent: 0 };
    }

    const payload = command.endsWith('\n') ? command : `${command}\n`;
    let sent = 0;
    const uniqueHostIds = new Set(hostIds);

    for (const hostId of uniqueHostIds) {
      const terminals = this.terminalManager.getTerminalInfosByHost(hostId);
      for (const terminalInfo of terminals) {
        if (terminalInfo.pty.isStreamActive()) {
          terminalInfo.pty.handleInput(payload);
          sent += 1;
        }
      }
    }

    return { sent };
  }

  /**
   * Send command to active tracked SSH terminal only
   */
  sendCommandToActiveTerminal(command: string): boolean {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) {
      return false;
    }

    const terminalId = this.terminalManager.getTerminalId(activeTerminal);
    if (!terminalId) {
      return false;
    }

    const pty = this.terminalManager.getPseudoTerminal(terminalId);
    if (!pty || !pty.isStreamActive()) {
      return false;
    }

    const payload = command.endsWith('\n') ? command : `${command}\n`;
    pty.handleInput(payload);
    return true;
  }

  /**
   * Focus the first tracked terminal for a host
   */
  focusHostTerminal(hostId: string): boolean {
    const terminals = this.terminalManager.getTerminalsByHost(hostId);
    if (terminals.length === 0) {
      return false;
    }

    terminals[0].show(false);
    return true;
  }

  /**
   * Focus a tracked terminal by terminal ID
   */
  focusTerminalById(terminalId: string): boolean {
    const terminalInfo = this.terminalManager.getTerminalInfo(terminalId);
    if (!terminalInfo) {
      return false;
    }

    terminalInfo.terminal.show(false);
    return true;
  }

  /**
   * Get a snapshot of tracked sessions for UI views
   */
  getSessionSnapshots(): SessionSnapshot[] {
    return this.terminalManager.getAllTerminals().map((info: TerminalInfo) => ({
      terminalId: info.terminalId,
      hostId: info.hostId,
      status: this.terminalStatuses.get(info.terminalId) || ConnectionStatus.DISCONNECTED,
      createdAt: info.createdAt
    }));
  }

  /**
   * Get hosts currently in broadcast scope
   */
  getBroadcastHostIds(): string[] {
    return Array.from(this.broadcastHostIds);
  }

  /**
   * Get connection state for a host
   */
  getConnectionState(hostId: string) {
    return this.stateTracker.getState(hostId);
  }

  /**
   * Get all active connections
   */
  getAllActiveConnections() {
    return this.stateTracker.getAllActive();
  }

  /**
   * Get the state tracker (for tree provider)
   */
  getStateTracker(): ConnectionStateTracker {
    return this.stateTracker;
  }

  private emitSessionChange(): void {
    this.onDidChangeSessionsEmitter.fire();
  }
}
