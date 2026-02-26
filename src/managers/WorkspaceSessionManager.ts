import * as vscode from 'vscode';
import { ConnectionMetadata, ConnectionStatus } from '../models/ConnectionState';
import { SSHHost } from '../models/SSHHost';
import { SSHPseudoTerminal } from '../providers/SSHPseudoTerminal';
import { CredentialService } from '../services/CredentialService';
import { formatHostConnectionTarget } from '../utils/hostDisplay';

const MAX_OUTPUT_BUFFER = 250_000;

export interface WorkspaceSessionSnapshot {
  id: string;
  workspaceId: string;
  hostId: string;
  hostLabel: string;
  hostSubtitle: string;
  status: ConnectionStatus;
  createdAt: number;
  output: string;
  lastError?: string;
}

export type WorkspaceSessionEvent =
  | { type: 'added'; session: WorkspaceSessionSnapshot }
  | { type: 'updated'; session: WorkspaceSessionSnapshot }
  | { type: 'output'; workspaceId: string; sessionId: string; chunk: string }
  | { type: 'removed'; workspaceId: string; sessionId: string; hostId: string };

interface ManagedWorkspaceSession {
  snapshot: WorkspaceSessionSnapshot;
  pty: SSHPseudoTerminal;
  subscriptions: vscode.Disposable[];
}

/**
 * Runs SSH pseudo-terminals without relying on VS Code's integrated terminal tabs.
 */
export class WorkspaceSessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, ManagedWorkspaceSession>();
  private readonly onDidSessionEventEmitter = new vscode.EventEmitter<WorkspaceSessionEvent>();
  readonly onDidSessionEvent = this.onDidSessionEventEmitter.event;

  constructor(private readonly credentialService: CredentialService) { }

  getAllSessions(workspaceId?: string): WorkspaceSessionSnapshot[] {
    return Array.from(this.sessions.values())
      .map(({ snapshot }) => snapshot)
      .filter((snapshot) => workspaceId === undefined || snapshot.workspaceId === workspaceId)
      .map((snapshot) => ({ ...snapshot }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getSessionCount(hostId: string, workspaceId?: string): number {
    let count = 0;
    for (const { snapshot } of this.sessions.values()) {
      if (
        snapshot.hostId === hostId &&
        (workspaceId === undefined || snapshot.workspaceId === workspaceId)
      ) {
        count += 1;
      }
    }
    return count;
  }

  getSessionInfos(hostId: string, workspaceId?: string): Array<{
    sessionId: string;
    workspaceId: string;
    hostId: string;
    createdAt: Date;
    status: ConnectionStatus;
    lastError?: string;
  }> {
    return Array.from(this.sessions.values())
      .map(({ snapshot }) => snapshot)
      .filter((snapshot) => {
        if (snapshot.hostId !== hostId) {
          return false;
        }

        return workspaceId === undefined || snapshot.workspaceId === workspaceId;
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((snapshot) => ({
        sessionId: snapshot.id,
        workspaceId: snapshot.workspaceId,
        hostId: snapshot.hostId,
        createdAt: new Date(snapshot.createdAt),
        status: snapshot.status,
        lastError: snapshot.lastError
      }));
  }

  getSessionWorkspaceId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.snapshot.workspaceId;
  }

  findWorkspaceWithHostSession(hostId: string): string | undefined {
    for (const { snapshot } of this.sessions.values()) {
      if (snapshot.hostId === hostId) {
        return snapshot.workspaceId;
      }
    }

    return undefined;
  }

  hasSession(sessionId: string, workspaceId?: string): boolean {
    const snapshot = this.sessions.get(sessionId)?.snapshot;
    if (!snapshot) {
      return false;
    }

    return workspaceId === undefined || snapshot.workspaceId === workspaceId;
  }

  hasHostSessions(hostId: string, workspaceId?: string): boolean {
    for (const { snapshot } of this.sessions.values()) {
      if (
        snapshot.hostId === hostId &&
        (workspaceId === undefined || snapshot.workspaceId === workspaceId)
      ) {
        return true;
      }
    }

    return false;
  }

  async connectHosts(hosts: SSHHost[], workspaceId: string): Promise<WorkspaceSessionSnapshot[]> {
    const snapshots: WorkspaceSessionSnapshot[] = [];
    for (const host of hosts) {
      const snapshot = await this.connectHost(host, workspaceId);
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  async connectHost(host: SSHHost, workspaceId: string): Promise<WorkspaceSessionSnapshot> {
    const sessionId = `workspace-${host.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshot: WorkspaceSessionSnapshot = {
      id: sessionId,
      workspaceId,
      hostId: host.id,
      hostLabel: host.label,
      hostSubtitle: formatHostConnectionTarget(host),
      status: ConnectionStatus.DISCONNECTED,
      createdAt: Date.now(),
      output: ''
    };

    const pty = new SSHPseudoTerminal(
      host,
      this.credentialService,
      sessionId,
      (status, metadata) => {
        this.updateSessionStatus(sessionId, status, metadata);
      }
    );

    const subscriptions: vscode.Disposable[] = [
      pty.onDidWrite((chunk) => {
        this.appendOutput(sessionId, chunk);
      })
    ];
    if (pty.onDidClose) {
      subscriptions.push(
        pty.onDidClose((exitCode) => {
          // Clean shell exits (e.g. user typed `exit`) remove the pane immediately.
          if (exitCode === 0 || exitCode === undefined || exitCode === null) {
            this.removeSession(sessionId, false);
            return;
          }

          this.updateSessionStatus(sessionId, ConnectionStatus.ERROR, {
            error: 'Session terminated unexpectedly'
          });
        })
      );
    }

    this.sessions.set(sessionId, {
      snapshot,
      pty,
      subscriptions
    });
    this.onDidSessionEventEmitter.fire({ type: 'added', session: { ...snapshot } });

    try {
      await pty.open({ columns: 120, rows: 36 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateSessionStatus(sessionId, ConnectionStatus.ERROR, { error: message });
    }

    return { ...snapshot };
  }

  sendInput(sessionId: string, input: string, workspaceId?: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed || (workspaceId !== undefined && managed.snapshot.workspaceId !== workspaceId)) {
      return false;
    }

    try {
      managed.pty.handleInput(input);
    } catch {
      return false;
    }
    return true;
  }

  broadcastInput(workspaceId: string, sourceSessionId: string, input: string): number {
    let sent = 0;
    for (const [sessionId, managed] of this.sessions.entries()) {
      if (sessionId === sourceSessionId) {
        continue;
      }

      if (managed.snapshot.workspaceId !== workspaceId) {
        continue;
      }

      if (managed.snapshot.status !== ConnectionStatus.CONNECTED || !managed.pty.isStreamActive()) {
        continue;
      }

      try {
        managed.pty.handleInput(input);
        sent += 1;
      } catch {
        // Ignore individual session write failures.
      }
    }

    return sent;
  }

  sendInputToHosts(hostIds: string[], input: string, workspaceId?: string): number {
    const hostIdSet = new Set(hostIds);
    if (hostIdSet.size === 0) {
      return 0;
    }

    let sent = 0;
    for (const managed of this.sessions.values()) {
      if (!hostIdSet.has(managed.snapshot.hostId)) {
        continue;
      }

      if (workspaceId !== undefined && managed.snapshot.workspaceId !== workspaceId) {
        continue;
      }

      if (managed.snapshot.status !== ConnectionStatus.CONNECTED || !managed.pty.isStreamActive()) {
        continue;
      }

      try {
        managed.pty.handleInput(input);
        sent += 1;
      } catch {
        // Ignore individual session write failures.
      }
    }

    return sent;
  }

  resizeSession(sessionId: string, columns: number, rows: number, workspaceId?: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed || (workspaceId !== undefined && managed.snapshot.workspaceId !== workspaceId)) {
      return false;
    }

    const safeColumns = Math.max(2, Math.floor(columns));
    const safeRows = Math.max(1, Math.floor(rows));
    try {
      managed.pty.setDimensions({ columns: safeColumns, rows: safeRows });
    } catch {
      return false;
    }
    return true;
  }

  disconnectSession(sessionId: string, workspaceId?: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed || (workspaceId !== undefined && managed.snapshot.workspaceId !== workspaceId)) {
      return false;
    }

    this.removeSession(sessionId, true);
    return true;
  }

  disconnectAll(workspaceId?: string): void {
    const sessionIds = Array.from(this.sessions.values())
      .filter(({ snapshot }) => workspaceId === undefined || snapshot.workspaceId === workspaceId)
      .map(({ snapshot }) => snapshot.id);
    for (const sessionId of sessionIds) {
      this.disconnectSession(sessionId);
    }
  }

  dispose(): void {
    this.disconnectAll();
    this.onDidSessionEventEmitter.dispose();
  }

  private updateSessionStatus(
    sessionId: string,
    status: ConnectionStatus,
    metadata?: ConnectionMetadata
  ): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return;
    }

    managed.snapshot.status = status;
    if (metadata?.error) {
      managed.snapshot.lastError = metadata.error;
    } else if (status === ConnectionStatus.CONNECTED || status === ConnectionStatus.DISCONNECTED) {
      managed.snapshot.lastError = undefined;
    }

    this.onDidSessionEventEmitter.fire({
      type: 'updated',
      session: { ...managed.snapshot }
    });
  }

  private appendOutput(sessionId: string, rawChunk: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return;
    }

    const nextOutput = `${managed.snapshot.output}${rawChunk}`;
    managed.snapshot.output = nextOutput.length > MAX_OUTPUT_BUFFER
      ? nextOutput.slice(nextOutput.length - MAX_OUTPUT_BUFFER)
      : nextOutput;

    this.onDidSessionEventEmitter.fire({
      type: 'output',
      workspaceId: managed.snapshot.workspaceId,
      sessionId,
      chunk: rawChunk
    });
  }

  private removeSession(sessionId: string, closePty: boolean): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return;
    }

    const { hostId, workspaceId } = managed.snapshot;
    this.sessions.delete(sessionId);

    if (closePty) {
      managed.pty.close();
    }

    for (const subscription of managed.subscriptions) {
      subscription.dispose();
    }

    this.onDidSessionEventEmitter.fire({ type: 'removed', workspaceId, sessionId, hostId });
  }
}
