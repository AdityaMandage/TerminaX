import { TreeNode, TreeNodeType } from './TreeNode';

/**
 * Represents an active terminal session as a child node in the tree
 */
export interface SessionNode extends TreeNode {
    type: TreeNodeType.SESSION;

    /** Terminal ID for focus/identification */
    terminalId: string;

    /** Associated host ID */
    hostId: string;

    /** When the session was created */
    createdAt: Date;
}

/**
 * Create a SessionNode from terminal info
 */
export function createSessionNode(
    terminalId: string,
    hostId: string,
    label: string,
    createdAt: Date
): SessionNode {
    return {
        id: `session-${terminalId}`,
        type: TreeNodeType.SESSION,
        label,
        parentId: hostId,
        sortOrder: createdAt.getTime(),
        terminalId,
        hostId,
        createdAt
    };
}
