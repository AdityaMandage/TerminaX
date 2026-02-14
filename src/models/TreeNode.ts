/**
 * Tree node types for the SSH hosts tree view
 */
export enum TreeNodeType {
  FOLDER = 'folder',
  HOST = 'host',
  SESSION = 'session'
}

/**
 * Base interface for all tree items (folders and hosts)
 */
export interface TreeNode {
  /** Unique identifier (UUID) */
  id: string;

  /** Type of node */
  type: TreeNodeType;

  /** Display label */
  label: string;

  /** Parent node ID (null for root items) */
  parentId: string | null;

  /** Sort order within parent */
  sortOrder: number;
}
