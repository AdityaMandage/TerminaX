import * as vscode from 'vscode';
import { TreeNode, TreeNodeType } from '../models/TreeNode';
import { SSHHost } from '../models/SSHHost';
import { SSHFolder } from '../models/SSHFolder';
import { SessionNode, createSessionNode } from '../models/SessionNode';
import { ConnectionStatus, ConnectionStateTracker } from '../models/ConnectionState';
import { HostHealthState, HostHealthStatus } from '../models/HealthState';
import { ConfigManager } from '../managers/ConfigManager';
import { formatDuration } from '../utils/treeHelpers';
import { formatHostConnectionTarget, formatHostSummary } from '../utils/hostDisplay';

/**
 * Reader interface for active session info (avoids tight coupling to ConnectionManager)
 */
export interface SessionReader {
  getTerminalCount(hostId: string): number;
  getSessionInfos(hostId: string): Array<{
    terminalId: string;
    hostId: string;
    createdAt: Date;
    status: ConnectionStatus;
    lastError?: string;
  }>;
}

/**
 * Tree data provider for SSH hosts with drag-and-drop support
 */
export class SSHTreeDataProvider
  implements
  vscode.TreeDataProvider<TreeNode>,
  vscode.TreeDragAndDropController<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Drag and drop MIME type
  readonly dropMimeTypes = ['application/vnd.code.tree.terminax'];
  readonly dragMimeTypes = ['application/vnd.code.tree.terminax'];
  private filterQuery: string = '';
  private filteredVisibleNodeIds: Set<string> | null = null;

  constructor(
    private configManager: ConfigManager,
    private connectionStateTracker: ConnectionStateTracker,
    private healthStateReader?: {
      getHostHealth(hostId: string): HostHealthState | undefined;
    },
    private sessionReader?: SessionReader
  ) { }

  setFilterQuery(query: string): void {
    const normalized = query.trim().toLowerCase();
    this.filterQuery = normalized;
    this.rebuildFilterCache();
    this.refresh();
  }

  getFilterQuery(): string {
    return this.filterQuery;
  }

  /**
   * Get the tree item representation of a node
   */
  getTreeItem(element: TreeNode): vscode.TreeItem {
    // Handle session nodes
    if (element.type === TreeNodeType.SESSION) {
      return this.getSessionTreeItem(element as SessionNode);
    }

    const sessionCount = this.sessionReader?.getTerminalCount(element.id) ?? 0;

    const folder = element.type === TreeNodeType.FOLDER
      ? (element as SSHFolder)
      : undefined;

    const item = new vscode.TreeItem(
      element.label,
      element.type === TreeNodeType.FOLDER
        ? (folder?.expanded === false
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded)
        : sessionCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
    );

    // Set context value for context menu filtering
    item.contextValue = element.type;

    // Set icon and tooltip based on type
    if (element.type === TreeNodeType.HOST) {
      const host = element as SSHHost;
      const trackedState = this.connectionStateTracker.getState(element.id);
      const sessionInfos = this.sessionReader?.getSessionInfos(element.id) ?? [];
      const connectedSessions = sessionInfos.filter(
        (session) => session.status === ConnectionStatus.CONNECTED
      );
      const hasConnectedSessions = connectedSessions.length > 0;
      const firstConnectedSessionStartedAt = hasConnectedSessions
        ? new Date(Math.min(...connectedSessions.map((session) => session.createdAt.getTime())))
        : undefined;
      const latestSessionError = sessionInfos.find(
        (session) => session.status === ConnectionStatus.ERROR && session.lastError
      )?.lastError;
      const effectiveState = hasConnectedSessions
        ? {
          status: ConnectionStatus.CONNECTED,
          connectedAt: firstConnectedSessionStartedAt,
          lastError: trackedState?.lastError
        }
        : trackedState?.status === ConnectionStatus.ERROR || latestSessionError
          ? {
            status: ConnectionStatus.ERROR,
            connectedAt: trackedState?.connectedAt,
            lastError: trackedState?.lastError || latestSessionError
          }
        : trackedState;
      const health = this.healthStateReader?.getHostHealth(element.id);

      // Status-based icon
      item.iconPath = this.getHostIcon(effectiveState?.status, health);
      item.tooltip = this.getHostTooltip(host, effectiveState, health);

      // Description shows username@host and session count
      const baseDesc = this.getHostDescription(host, health);
      item.description = sessionCount > 0
        ? `${baseDesc} — ${sessionCount} session${sessionCount > 1 ? 's' : ''}`
        : baseDesc;
    } else {
      // Folder icon
      item.iconPath = new vscode.ThemeIcon('folder');
      const folder = element as SSHFolder;
      const children = this.configManager.getChildren(folder.id);
      item.tooltip = `${children.length} item(s)`;
    }

    return item;
  }

  /**
   * Get children of a node
   */
  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    const isFiltering = this.filterQuery.length > 0 && this.filteredVisibleNodeIds !== null;

    if (!element) {
      // Return root nodes
      const rootNodes = this.configManager.getRootNodes();
      if (!isFiltering) {
        return Promise.resolve(rootNodes);
      }

      return Promise.resolve(
        rootNodes.filter(node => this.filteredVisibleNodeIds!.has(node.id))
      );
    }

    if (element.type === TreeNodeType.FOLDER) {
      const children = this.configManager.getChildren(element.id);
      if (!isFiltering) {
        return Promise.resolve(children);
      }

      return Promise.resolve(
        children.filter(node => this.filteredVisibleNodeIds!.has(node.id))
      );
    }

    // HOST nodes: return active session children
    if (element.type === TreeNodeType.HOST && this.sessionReader) {
      const sessions = this.sessionReader.getSessionInfos(element.id);
      if (sessions.length > 0) {
        return Promise.resolve(
          sessions.map((s, i) =>
            createSessionNode(
              s.terminalId,
              s.hostId,
              `Session ${i + 1}`,
              s.createdAt
            )
          )
        );
      }
    }

    return Promise.resolve([]);
  }

  private rebuildFilterCache(): void {
    if (!this.filterQuery) {
      this.filteredVisibleNodeIds = null;
      return;
    }

    const visibleIds = new Set<string>();
    const allNodes = this.configManager.getAllNodes();

    for (const node of allNodes) {
      if (this.nodeMatchesFilter(node)) {
        visibleIds.add(node.id);
        this.includeAncestorChain(node, visibleIds);

        // If a folder matches by name/path, include all descendants for easier navigation.
        if (node.type === TreeNodeType.FOLDER) {
          this.includeDescendants(node.id, visibleIds);
        }
      }
    }

    this.filteredVisibleNodeIds = visibleIds;
  }

  private includeAncestorChain(node: TreeNode, visibleIds: Set<string>): void {
    let currentParentId = node.parentId;
    while (currentParentId) {
      const parent = this.configManager.getNode(currentParentId);
      if (!parent) {
        break;
      }

      visibleIds.add(parent.id);
      currentParentId = parent.parentId;
    }
  }

  private includeDescendants(folderId: string, visibleIds: Set<string>): void {
    const children = this.configManager.getChildren(folderId);
    for (const child of children) {
      visibleIds.add(child.id);
      if (child.type === TreeNodeType.FOLDER) {
        this.includeDescendants(child.id, visibleIds);
      }
    }
  }

  private nodeMatchesFilter(node: TreeNode): boolean {
    const query = this.filterQuery;
    if (!query) {
      return true;
    }

    const path = this.getNodePath(node).toLowerCase();
    if (path.includes(query) || node.label.toLowerCase().includes(query)) {
      return true;
    }

    if (node.type === TreeNodeType.HOST) {
      const host = node as SSHHost;
      const hostFields = [
        host.config.host,
        host.config.username,
        host.config.port.toString(),
        host.config.authMethod
      ]
        .join(' ')
        .toLowerCase();

      return hostFields.includes(query);
    }

    return false;
  }

  private getNodePath(node: TreeNode): string {
    const pathParts: string[] = [node.label];
    let currentParentId = node.parentId;

    while (currentParentId) {
      const parent = this.configManager.getNode(currentParentId);
      if (!parent) {
        break;
      }

      pathParts.unshift(parent.label);
      currentParentId = parent.parentId;
    }

    return pathParts.join(' / ');
  }

  /**
   * Get parent of a node
   */
  getParent(element: TreeNode): vscode.ProviderResult<TreeNode> {
    if (!element.parentId) {
      return null;
    }
    return this.configManager.getNode(element.parentId);
  }

  /**
   * Refresh the tree view
   */
  refresh(element?: TreeNode): void {
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Handle drag operation
   */
  handleDrag(
    source: readonly TreeNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    void _token;


    // Add dragged items to the data transfer object
    dataTransfer.set(
      this.dragMimeTypes[0],
      new vscode.DataTransferItem(source)
    );
  }

  /**
   * Handle drop operation
   */
  async handleDrop(
    target: TreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    void _token;

    // Get the dragged items
    const transferItem = dataTransfer.get(this.dragMimeTypes[0]);
    if (!transferItem) {
      return;
    }

    const nodes = transferItem.value as TreeNode[];

    // Determine the new parent
    let newParentId: string | null;
    if (!target) {
      // Dropped on empty space -> move to root
      newParentId = null;
    } else if (target.type === TreeNodeType.FOLDER) {
      // Dropped on folder -> move into folder
      newParentId = target.id;
    } else {
      // Dropped on host -> move to same parent as host
      newParentId = target.parentId;
    }

    // Dropping a node onto itself should be a no-op.
    if (target && nodes.some(node => node.id === target.id)) {
      return;
    }

    const movedIds: string[] = [];

    // Move nodes across parents first
    for (const node of nodes) {
      try {
        if (node.parentId !== newParentId) {
          await this.configManager.moveNode(node.id, newParentId);
        }
        movedIds.push(node.id);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to move "${node.label}": ${error}`);
      }
    }

    if (movedIds.length === 0) {
      return;
    }

    // Apply sibling order update so same-parent drag/drop can reorder items.
    const siblings = newParentId
      ? this.configManager.getChildren(newParentId)
      : this.configManager.getRootNodes();

    const remainingIds = siblings
      .filter(node => !movedIds.includes(node.id))
      .map(node => node.id);

    let orderedIds: string[] = [];

    if (target && target.type === TreeNodeType.HOST && !movedIds.includes(target.id)) {
      const insertIndex = remainingIds.indexOf(target.id);
      if (insertIndex === -1) {
        orderedIds = [...remainingIds, ...movedIds];
      } else {
        orderedIds = [
          ...remainingIds.slice(0, insertIndex),
          ...movedIds,
          ...remainingIds.slice(insertIndex)
        ];
      }
    } else {
      orderedIds = [...remainingIds, ...movedIds];
    }

    await this.configManager.reorderNodes(newParentId, orderedIds);

    // Refresh the tree
    this.refresh();
  }

  /**
   * Get icon for a host based on connection status
   */
  private getHostIcon(
    status?: ConnectionStatus,
    health?: HostHealthState
  ): vscode.ThemeIcon {
    if (health?.status === HostHealthStatus.UNHEALTHY) {
      return new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('terminal.ansiRed')
      );
    }

    switch (status) {
      case ConnectionStatus.CONNECTED:
        return new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('terminal.ansiGreen')
        );
      case ConnectionStatus.ERROR:
        return new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('terminal.ansiRed')
        );
      default:
        // Disconnected state uses health indicator when available.
        if (health?.status === HostHealthStatus.CHECKING) {
          return new vscode.ThemeIcon('loading~spin');
        }

        if (health?.status === HostHealthStatus.HEALTHY) {
          return new vscode.ThemeIcon(
            'circle-filled',
            new vscode.ThemeColor('terminal.ansiBlue')
          );
        }

        // Unknown health or never checked.
        return new vscode.ThemeIcon(
          'circle-outline',
          new vscode.ThemeColor('terminal.ansiBrightBlack')
        );
    }
  }

  /**
   * Get tooltip for a host
   */
  private getHostTooltip(
    host: SSHHost,
    state?: {
      status: ConnectionStatus;
      connectedAt?: Date;
      lastError?: string;
    },
    health?: HostHealthState
  ): string {
    const baseInfo = formatHostConnectionTarget(host);
    const healthInfo = this.formatHealthTooltip(health);

    if (!state || state.status === ConnectionStatus.DISCONNECTED) {
      return healthInfo ? `${baseInfo}\n${healthInfo}` : baseInfo;
    }

    if (state.status === ConnectionStatus.CONNECTED) {
      const duration = state.connectedAt
        ? formatDuration(Date.now() - state.connectedAt.getTime())
        : '';
      const connectedLine = `Connected${duration ? ` for ${duration}` : ''}`;
      return healthInfo
        ? `${baseInfo}\n${connectedLine}\n${healthInfo}`
        : `${baseInfo}\n${connectedLine}`;
    }

    if (state.status === ConnectionStatus.ERROR) {
      const errorLine = `Error: ${state.lastError || 'Connection lost'}`;
      return healthInfo
        ? `${baseInfo}\n${errorLine}\n${healthInfo}`
        : `${baseInfo}\n${errorLine}`;
    }

    return baseInfo;
  }

  private getHostDescription(host: SSHHost, health?: HostHealthState): string {
    const base = formatHostSummary(host);
    if (!health) {
      return base;
    }

    if (health.status === HostHealthStatus.HEALTHY && health.latencyMs !== undefined) {
      return `${base} (${health.latencyMs}ms)`;
    }

    if (health.status === HostHealthStatus.UNHEALTHY) {
      return `${base} (unhealthy)`;
    }

    if (health.status === HostHealthStatus.CHECKING) {
      return `${base} (checking...)`;
    }

    return base;
  }

  private formatHealthTooltip(health?: HostHealthState): string | undefined {
    if (!health) {
      return undefined;
    }

    switch (health.status) {
      case HostHealthStatus.CHECKING:
        return 'Health: checking...';
      case HostHealthStatus.HEALTHY: {
        const latency = health.latencyMs !== undefined ? `${health.latencyMs}ms` : 'reachable';
        return `Health: reachable (${latency})`;
      }
      case HostHealthStatus.UNHEALTHY:
        return `Health: ${health.error || 'unreachable'}`;
      default:
        return 'Health: unknown';
    }
  }

  /**
   * Render a session child node
   */
  private getSessionTreeItem(session: SessionNode): vscode.TreeItem {
    const duration = formatDuration(Date.now() - session.createdAt.getTime());
    const item = new vscode.TreeItem(
      `${session.label} (${duration})`,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = TreeNodeType.SESSION;
    item.iconPath = new vscode.ThemeIcon(
      'terminal',
      new vscode.ThemeColor('terminal.ansiGreen')
    );
    item.tooltip = `Active session — started ${session.createdAt.toLocaleTimeString()}`;
    // Click-to-focus: use the built-in command on the session reader
    item.command = {
      command: 'terminax.focusSession',
      title: 'Focus Terminal',
      arguments: [session.hostId, session.terminalId]
    };
    return item;
  }

}
