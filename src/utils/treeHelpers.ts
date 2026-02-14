import { TreeNode } from '../models/TreeNode';

/**
 * Node path/location resolver interface — avoids direct ConfigManager import
 */
interface NodeResolver {
    getNode(id: string): TreeNode | undefined;
}

/**
 * Build the location path string for a node (e.g. "Folder1 / Subfolder2")
 */
export function getNodeLocationPath(node: TreeNode, resolver: NodeResolver): string {
    const pathParts: string[] = [];
    let currentParentId = node.parentId;

    while (currentParentId) {
        const parent = resolver.getNode(currentParentId);
        if (!parent) {
            break;
        }
        pathParts.unshift(parent.label);
        currentParentId = parent.parentId;
    }

    return pathParts.length > 0 ? pathParts.join(' / ') : 'Root';
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}
