import * as vscode from 'vscode';
import * as path from 'path';

interface DocumentationNode {
  id: string;
  label: string;
  commandId: string;
  icon: string;
}

export class HelpTreeDataProvider implements vscode.TreeDataProvider<DocumentationNode> {
  private readonly nodes: DocumentationNode[] = [
    {
      id: 'open-help',
      label: 'Help Documentation',
      commandId: 'terminax.openHelp',
      icon: 'question'
    },
    {
      id: 'open-readme',
      label: 'README',
      commandId: 'terminax.openReadme',
      icon: 'book'
    }
  ];

  getTreeItem(element: DocumentationNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );

    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = {
      command: element.commandId,
      title: element.label
    };

    return item;
  }

  getChildren(): vscode.ProviderResult<DocumentationNode[]> {
    return this.nodes;
  }
}
