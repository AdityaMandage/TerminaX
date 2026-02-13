import * as vscode from 'vscode';
import { SSHFolder, createSSHFolder } from '../models/SSHFolder';
import { ConfigManager } from '../managers/ConfigManager';
import { CredentialService } from '../services/CredentialService';
import { SSHTreeDataProvider } from '../providers/SSHTreeDataProvider';
import { generateUUID } from '../utils/common';

/**
 * Register all folder-related commands
 */
export function registerFolderCommands(
  context: vscode.ExtensionContext,
  configManager: ConfigManager,
  credentialService: CredentialService,
  treeProvider: SSHTreeDataProvider
): void {

  // Add new folder
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.addFolder', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter folder name',
        placeHolder: 'Production Servers',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value) {
            return 'Folder name is required';
          }
          return undefined;
        }
      });

      if (!name) {
        return;
      }

      const folder = createSSHFolder(
        generateUUID(),
        name,
        null
      );

      await configManager.addNode(folder);
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Folder "${name}" created successfully`);
    })
  );

  // Add new subfolder under a specific folder
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.addFolderInFolder', async (parentFolder?: SSHFolder) => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter folder name',
        placeHolder: 'Production Servers',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value) {
            return 'Folder name is required';
          }
          return undefined;
        }
      });

      if (!name) {
        return;
      }

      const folder = createSSHFolder(
        generateUUID(),
        name,
        parentFolder?.id || null
      );

      await configManager.addNode(folder);
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Folder "${name}" created successfully`);
    })
  );

  // Rename folder
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.renameFolder', async (folder: SSHFolder) => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter new folder name',
        value: folder.label,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value) {
            return 'Folder name is required';
          }
          return undefined;
        }
      });

      if (!name || name === folder.label) {
        return;
      }

      await configManager.updateNode(folder.id, { label: name });
      treeProvider.refresh();

      vscode.window.showInformationMessage(`Folder renamed to "${name}"`);
    })
  );

  // Delete folder
  context.subscriptions.push(
    vscode.commands.registerCommand('terminax.deleteFolder', async (folder: SSHFolder) => {
      const children = configManager.getChildren(folder.id);
      const childCount = children.length;

      const message = childCount > 0
        ? `Are you sure you want to delete "${folder.label}" and its ${childCount} item(s)?`
        : `Are you sure you want to delete "${folder.label}"?`;

      const confirm = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        const hostsToDelete = configManager.getAllHostsRecursive(folder.id);
        await configManager.deleteNode(folder.id);

        for (const host of hostsToDelete) {
          await credentialService.deleteAllCredentials(host.id);
        }

        treeProvider.refresh();

        vscode.window.showInformationMessage(`Folder "${folder.label}" deleted`);
      }
    })
  );
}
