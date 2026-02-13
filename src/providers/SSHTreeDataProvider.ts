import * as vscode from 'vscode';
import { TreeNode, TreeNodeType } from '../models/TreeNode';
import { SSHHost } from '../models/SSHHost';
import { SSHFolder } from '../models/SSHFolder';
import { ConnectionStatus, ConnectionStateTracker } from '../models/ConnectionState';
import { ConfigManager } from '../managers/ConfigManager';

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

  constructor(
    private configManager: ConfigManager,
    private connectionStateTracker: ConnectionStateTracker
  ) {}

  /**
   * Get the tree item representation of a node
   */
  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.type === TreeNodeType.FOLDER
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    // Set context value for context menu filtering
    item.contextValue = element.type;

    // Set icon and tooltip based on type
    if (element.type === TreeNodeType.HOST) {
      const host = element as SSHHost;
      const state = this.connectionStateTracker.getState(element.id);

      // Status-based icon
      item.iconPath = this.getHostIcon(state?.status);
      item.tooltip = this.getHostTooltip(host, state);

      // Description shows username@host
      item.description = `${host.config.username}@${host.config.host}`;

      // Default command when clicking the host
      item.command = {
        command: 'terminax.connect',
        title: 'Connect to Host',
        arguments: [element]
      };
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
    if (!element) {
      // Return root nodes
      return Promise.resolve(this.configManager.getRootNodes());
    }

    if (element.type === TreeNodeType.FOLDER) {
      return Promise.resolve(this.configManager.getChildren(element.id));
    }

    return Promise.resolve([]);
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
    token: vscode.CancellationToken
  ): void | Thenable<void> {
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
    token: vscode.CancellationToken
  ): Promise<void> {
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

    // Move each node
    for (const node of nodes) {
      try {
        // Skip if dropping on itself or its own parent
        if (node.parentId === newParentId) {
          continue;
        }

        await this.configManager.moveNode(node.id, newParentId);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to move "${node.label}": ${error}`);
      }
    }

    // Refresh the tree
    this.refresh();
  }

  /**
   * Get icon for a host based on connection status
   */
  private getHostIcon(status?: ConnectionStatus): vscode.ThemeIcon {
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
        // DISCONNECTED or undefined
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
    }
  ): string {
    const baseInfo = `${host.config.username}@${host.config.host}:${host.config.port}`;

    if (!state || state.status === ConnectionStatus.DISCONNECTED) {
      return baseInfo;
    }

    if (state.status === ConnectionStatus.CONNECTED) {
      const duration = state.connectedAt
        ? this.formatDuration(Date.now() - state.connectedAt.getTime())
        : '';
      return `${baseInfo}\n🟢 Connected${duration ? ` for ${duration}` : ''}`;
    }

    if (state.status === ConnectionStatus.ERROR) {
      return `${baseInfo}\n🔴 Error: ${state.lastError || 'Connection lost'}`;
    }

    return baseInfo;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }
}
