import * as vscode from 'vscode';

interface HelpNode {
  id: string;
  label: string;
  description: string;
  commandId: string;
}

export class HelpTreeDataProvider implements vscode.TreeDataProvider<HelpNode> {
  private readonly nodes: HelpNode[] = [
    {
      id: 'open-help',
      label: 'Open TerminaX Help',
      description: 'Shortcuts, search, and connection tips',
      commandId: 'terminax.openHelp'
    }
  ];

  getTreeItem(element: HelpNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon('question');
    item.command = {
      command: element.commandId,
      title: element.label
    };

    return item;
  }

  getChildren(): vscode.ProviderResult<HelpNode[]> {
    return this.nodes;
  }
}
