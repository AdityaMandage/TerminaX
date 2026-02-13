import { TreeNode, TreeNodeType } from './TreeNode';

/**
 * SSH authentication methods
 */
export type AuthMethod = 'password' | 'keyfile' | 'agent';

/**
 * SSH connection configuration
 */
export interface SSHConnectionConfig {
  /** Hostname or IP address */
  host: string;

  /** SSH port (default: 22) */
  port: number;

  /** Username for SSH connection */
  username: string;

  /** Authentication method */
  authMethod: AuthMethod;

  /** Path to private key file (for keyfile auth) */
  privateKeyPath?: string;

  /** Keepalive interval in milliseconds */
  keepaliveInterval?: number;

  /** Maximum keepalive count before considering connection dead */
  keepaliveCountMax?: number;
}

/**
 * SSH host node in the tree
 */
export interface SSHHost extends TreeNode {
  type: TreeNodeType.HOST;

  /** SSH connection configuration */
  config: SSHConnectionConfig;

  /** Optional description */
  description?: string;

  /** Optional tags for categorization */
  tags?: string[];
}

/**
 * Create a new SSH host with default values
 */
export function createSSHHost(
  id: string,
  label: string,
  hostname: string,
  username: string,
  parentId: string | null = null,
  port: number = 22,
  authMethod: AuthMethod = 'password'
): SSHHost {
  return {
    id,
    type: TreeNodeType.HOST,
    label,
    parentId,
    sortOrder: 0,
    config: {
      host: hostname,
      port,
      username,
      authMethod,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3
    }
  };
}
