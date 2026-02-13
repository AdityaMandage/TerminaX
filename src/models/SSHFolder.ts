import { TreeNode, TreeNodeType } from './TreeNode';

/**
 * Folder node for organizing SSH hosts
 */
export interface SSHFolder extends TreeNode {
  type: TreeNodeType.FOLDER;

  /** Whether the folder is expanded in the tree */
  expanded: boolean;

  /** Array of child node IDs */
  children: string[];
}

/**
 * Create a new SSH folder
 */
export function createSSHFolder(
  id: string,
  label: string,
  parentId: string | null = null
): SSHFolder {
  return {
    id,
    type: TreeNodeType.FOLDER,
    label,
    parentId,
    sortOrder: 0,
    expanded: true,
    children: []
  };
}
