import * as vscode from 'vscode';
import { TreeNode, TreeNodeType } from '../models/TreeNode';
import { SSHHost } from '../models/SSHHost';
import { SSHFolder } from '../models/SSHFolder';

/**
 * Configuration structure stored in globalState
 */
export interface TerminaXConfig {
  version: string;
  nodes: TreeNode[];
  lastModified: Date;
}

/**
 * Manages configuration persistence using VSCode's globalState
 */
export class ConfigManager {
  private static readonly CONFIG_KEY = 'terminax.config';
  private static readonly CONFIG_VERSION = '1.0.0';

  private config: TerminaXConfig;
  private nodesMap: Map<string, TreeNode> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    this.config = this.loadConfig();
    this.buildNodesMap();
  }

  /**
   * Load configuration from globalState
   */
  private loadConfig(): TerminaXConfig {
    const stored = this.context.globalState.get<TerminaXConfig>(ConfigManager.CONFIG_KEY);

    if (stored) {
      // Convert date strings back to Date objects
      stored.lastModified = new Date(stored.lastModified);
      return stored;
    }

    // Return default empty config
    return {
      version: ConfigManager.CONFIG_VERSION,
      nodes: [],
      lastModified: new Date()
    };
  }

  /**
   * Save configuration to globalState
   */
  private async saveConfig(): Promise<void> {
    this.config.lastModified = new Date();
    await this.context.globalState.update(ConfigManager.CONFIG_KEY, this.config);
  }

  /**
   * Build the nodes map for quick lookups
   */
  private buildNodesMap(): void {
    this.nodesMap.clear();
    this.config.nodes.forEach(node => {
      this.nodesMap.set(node.id, node);
    });
  }

  /**
   * Get all root nodes (nodes without a parent)
   */
  getRootNodes(): TreeNode[] {
    return this.config.nodes
      .filter(node => node.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Get children of a specific node
   */
  getChildren(parentId: string): TreeNode[] {
    return this.config.nodes
      .filter(node => node.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Get a node by its ID
   */
  getNode(id: string): TreeNode | undefined {
    return this.nodesMap.get(id);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): TreeNode[] {
    return this.config.nodes;
  }

  /**
   * Add a new node
   */
  async addNode(node: TreeNode): Promise<void> {
    // Set sort order to be last among siblings
    const siblings = node.parentId
      ? this.getChildren(node.parentId)
      : this.getRootNodes();
    node.sortOrder = siblings.length;

    this.config.nodes.push(node);
    this.nodesMap.set(node.id, node);
    await this.saveConfig();
  }

  /**
   * Update an existing node
   */
  async updateNode(id: string, updates: Partial<TreeNode>): Promise<void> {
    const node = this.nodesMap.get(id);
    if (node) {
      Object.assign(node, updates);
      await this.saveConfig();
    }
  }

  /**
   * Delete a node (and recursively delete children if it's a folder)
   */
  async deleteNode(id: string): Promise<void> {
    const node = this.nodesMap.get(id);
    if (!node) {
      return;
    }

    // If it's a folder, recursively delete children
    if (node.type === TreeNodeType.FOLDER) {
      const children = this.getChildren(id);
      for (const child of children) {
        await this.deleteNode(child.id);
      }
    }

    // Remove the node
    this.config.nodes = this.config.nodes.filter(n => n.id !== id);
    this.nodesMap.delete(id);

    // Reorder siblings
    await this.reorderSiblings(node.parentId);
    await this.saveConfig();
  }

  /**
   * Move a node to a new parent
   */
  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const node = this.nodesMap.get(nodeId);
    if (!node) {
      return;
    }

    // Prevent moving a folder into its own descendant
    if (node.type === TreeNodeType.FOLDER && this.isDescendant(newParentId, nodeId)) {
      throw new Error('Cannot move a folder into its own descendant');
    }

    const oldParentId = node.parentId;
    node.parentId = newParentId;

    // Update sort order to be last in new parent
    const newSiblings = newParentId
      ? this.getChildren(newParentId)
      : this.getRootNodes();
    node.sortOrder = newSiblings.filter(n => n.id !== nodeId).length;

    // Reorder old siblings
    await this.reorderSiblings(oldParentId);

    await this.saveConfig();
  }

  /**
   * Reorder siblings under a parent
   */
  private async reorderSiblings(parentId: string | null): Promise<void> {
    const siblings = parentId
      ? this.getChildren(parentId)
      : this.getRootNodes();

    siblings.forEach((node, index) => {
      node.sortOrder = index;
    });
  }

  /**
   * Reorder nodes explicitly
   */
  async reorderNodes(parentId: string | null, orderedIds: string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const node = this.nodesMap.get(id);
      if (node && node.parentId === parentId) {
        node.sortOrder = index;
      }
    });

    await this.saveConfig();
  }

  /**
   * Check if ancestorId is a descendant of nodeId (to prevent circular references)
   */
  private isDescendant(ancestorId: string | null, nodeId: string): boolean {
    if (!ancestorId) {
      return false;
    }

    let current = this.nodesMap.get(ancestorId);
    while (current) {
      if (current.id === nodeId) {
        return true;
      }
      current = current.parentId ? this.nodesMap.get(current.parentId) : undefined;
    }

    return false;
  }

  /**
   * Import configuration from JSON
   */
  async importConfig(configJson: string): Promise<void> {
    const imported = JSON.parse(configJson) as TerminaXConfig;
    imported.lastModified = new Date(imported.lastModified);
    this.config = imported;
    this.buildNodesMap();
    await this.saveConfig();
  }

  /**
   * Export configuration as JSON
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Get a specific host by ID
   */
  getHost(id: string): SSHHost | undefined {
    const node = this.nodesMap.get(id);
    return node?.type === TreeNodeType.HOST ? (node as SSHHost) : undefined;
  }

  /**
   * Get a specific folder by ID
   */
  getFolder(id: string): SSHFolder | undefined {
    const node = this.nodesMap.get(id);
    return node?.type === TreeNodeType.FOLDER ? (node as SSHFolder) : undefined;
  }

  /**
   * Get all hosts (optionally filtered by folder)
   */
  getAllHosts(folderId?: string): SSHHost[] {
    const nodes = folderId ? this.getChildren(folderId) : this.config.nodes;
    return nodes.filter(node => node.type === TreeNodeType.HOST) as SSHHost[];
  }

  /**
   * Get all hosts recursively under a folder
   */
  getAllHostsRecursive(folderId: string): SSHHost[] {
    const hosts: SSHHost[] = [];
    const folder = this.getFolder(folderId);

    if (!folder) {
      return hosts;
    }

    const children = this.getChildren(folderId);
    for (const child of children) {
      if (child.type === TreeNodeType.HOST) {
        hosts.push(child as SSHHost);
      } else if (child.type === TreeNodeType.FOLDER) {
        hosts.push(...this.getAllHostsRecursive(child.id));
      }
    }

    return hosts;
  }
}
