import * as vscode from 'vscode';
import { TreeNode, TreeNodeType } from '../models/TreeNode';
import { AuthMethod, SSHHost } from '../models/SSHHost';
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
    if (node.parentId) {
      const parent = this.nodesMap.get(node.parentId);
      if (!parent || parent.type !== TreeNodeType.FOLDER) {
        throw new Error('Parent must be a valid folder');
      }
    }

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

    if (newParentId) {
      const newParent = this.nodesMap.get(newParentId);
      if (!newParent || newParent.type !== TreeNodeType.FOLDER) {
        throw new Error('Destination must be a folder');
      }
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

  private normalizeAndValidateImportedConfig(rawConfig: unknown): TerminaXConfig {
    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new Error('Configuration must be a JSON object');
    }

    const configRecord = rawConfig as Record<string, unknown>;
    const rawNodes = configRecord.nodes;

    if (!Array.isArray(rawNodes)) {
      throw new Error('Configuration must contain a "nodes" array');
    }

    const parsedNodes: TreeNode[] = [];
    const idSet = new Set<string>();

    for (const rawNode of rawNodes) {
      if (!rawNode || typeof rawNode !== 'object') {
        throw new Error('Each node must be an object');
      }

      const nodeRecord = rawNode as Record<string, unknown>;
      const id = this.readRequiredString(nodeRecord.id, 'node.id');
      const label = this.readRequiredString(nodeRecord.label, `node(${id}).label`);
      const type = this.readNodeType(nodeRecord.type, `node(${id}).type`);
      const parentId = this.readOptionalNullableString(
        nodeRecord.parentId,
        `node(${id}).parentId`
      );
      const sortOrder = this.readOptionalNumber(nodeRecord.sortOrder, 0) ?? 0;

      if (idSet.has(id)) {
        throw new Error(`Duplicate node ID found: ${id}`);
      }
      idSet.add(id);

      if (type === TreeNodeType.HOST) {
        const hostConfig = this.parseHostConfig(nodeRecord.config, id);
        const host: SSHHost = {
          id,
          label,
          type: TreeNodeType.HOST,
          parentId,
          sortOrder,
          config: hostConfig
        };
        parsedNodes.push(host);
      } else {
        const folder: SSHFolder = {
          id,
          label,
          type: TreeNodeType.FOLDER,
          parentId,
          sortOrder,
          expanded: Boolean(nodeRecord.expanded ?? true),
          children: []
        };
        parsedNodes.push(folder);
      }
    }

    const nodesById = new Map(parsedNodes.map(node => [node.id, node]));
    for (const node of parsedNodes) {
      if (!node.parentId) {
        continue;
      }

      const parent = nodesById.get(node.parentId);
      if (!parent) {
        throw new Error(`Node "${node.id}" references missing parent "${node.parentId}"`);
      }

      if (parent.type !== TreeNodeType.FOLDER) {
        throw new Error(`Node "${node.id}" has non-folder parent "${node.parentId}"`);
      }
    }

    this.assertNoCycles(parsedNodes, nodesById);

    return {
      version:
        typeof configRecord.version === 'string'
          ? configRecord.version
          : ConfigManager.CONFIG_VERSION,
      nodes: parsedNodes,
      lastModified: this.parseDate(configRecord.lastModified)
    };
  }

  private parseHostConfig(rawConfig: unknown, nodeId: string): SSHHost['config'] {
    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new Error(`Host "${nodeId}" is missing "config"`);
    }

    const configRecord = rawConfig as Record<string, unknown>;
    const authMethod = this.readAuthMethod(
      configRecord.authMethod,
      `node(${nodeId}).config.authMethod`
    );

    const parsedConfig: SSHHost['config'] = {
      host: this.readRequiredString(configRecord.host, `node(${nodeId}).config.host`),
      username: this.readRequiredString(
        configRecord.username,
        `node(${nodeId}).config.username`
      ),
      port: this.readPort(configRecord.port, `node(${nodeId}).config.port`),
      authMethod
    };

    const privateKeyPath = this.readOptionalString(
      configRecord.privateKeyPath,
      `node(${nodeId}).config.privateKeyPath`
    );
    if (privateKeyPath) {
      parsedConfig.privateKeyPath = privateKeyPath;
    }

    const keepaliveInterval = this.readOptionalNumber(configRecord.keepaliveInterval);
    if (keepaliveInterval !== undefined) {
      parsedConfig.keepaliveInterval = keepaliveInterval;
    }

    const keepaliveCountMax = this.readOptionalNumber(configRecord.keepaliveCountMax);
    if (keepaliveCountMax !== undefined) {
      parsedConfig.keepaliveCountMax = keepaliveCountMax;
    }

    return parsedConfig;
  }

  private readNodeType(value: unknown, fieldPath: string): TreeNodeType {
    if (value === TreeNodeType.HOST || value === TreeNodeType.FOLDER) {
      return value;
    }
    throw new Error(`Invalid value for ${fieldPath}`);
  }

  private readAuthMethod(value: unknown, fieldPath: string): AuthMethod {
    if (value === 'password' || value === 'keyfile' || value === 'agent') {
      return value;
    }
    throw new Error(`Invalid value for ${fieldPath}`);
  }

  private readPort(value: unknown, fieldPath: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(`Invalid value for ${fieldPath}`);
    }
    return value;
  }

  private readRequiredString(value: unknown, fieldPath: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Invalid value for ${fieldPath}`);
    }
    return value;
  }

  private readOptionalString(value: unknown, fieldPath: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid value for ${fieldPath}`);
    }
    return value;
  }

  private readOptionalNullableString(value: unknown, fieldPath: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new Error(`Invalid value for ${fieldPath}`);
    }
    return value;
  }

  private readOptionalNumber(value: unknown, fallback?: number): number | undefined {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('Invalid numeric value in imported configuration');
    }
    return value;
  }

  private parseDate(value: unknown): Date {
    const parsedDate = value ? new Date(String(value)) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return new Date();
    }
    return parsedDate;
  }

  private assertNoCycles(nodes: TreeNode[], nodesById: Map<string, TreeNode>): void {
    for (const node of nodes) {
      const visited = new Set<string>();
      let current: TreeNode | undefined = node;

      while (current?.parentId) {
        if (visited.has(current.id)) {
          throw new Error(`Cycle detected at node "${node.id}"`);
        }
        visited.add(current.id);
        current = nodesById.get(current.parentId);
      }
    }
  }

  /**
   * Import configuration from JSON
   */
  async importConfig(configJson: string): Promise<void> {
    const imported = JSON.parse(configJson) as unknown;
    this.config = this.normalizeAndValidateImportedConfig(imported);
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
   * Get hosts that are visible in the tree (valid parent chain from roots)
   */
  getAllVisibleHosts(): SSHHost[] {
    const hosts: SSHHost[] = [];

    const visitNode = (node: TreeNode): void => {
      if (node.type === TreeNodeType.HOST) {
        hosts.push(node as SSHHost);
        return;
      }

      const children = this.getChildren(node.id);
      for (const child of children) {
        visitNode(child);
      }
    };

    const rootNodes = this.getRootNodes();
    for (const rootNode of rootNodes) {
      visitNode(rootNode);
    }

    // De-duplicate by ID in case legacy data accidentally contains duplicates.
    const uniqueById = new Map<string, SSHHost>();
    for (const host of hosts) {
      uniqueById.set(host.id, host);
    }

    return Array.from(uniqueById.values());
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
