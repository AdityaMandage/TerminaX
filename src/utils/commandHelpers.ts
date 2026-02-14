import * as vscode from 'vscode';

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

export function registerSafeCommand<TArgs extends unknown[]>(
  context: vscode.ExtensionContext,
  commandId: string,
  handler: (...args: TArgs) => Promise<void> | void
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(commandId, async (...args: TArgs) => {
      try {
        await handler(...args);
      } catch (error) {
        console.error(`[TerminaX] Command "${commandId}" failed`, error);
        vscode.window.showErrorMessage(
          `TerminaX: "${commandId}" failed: ${toErrorMessage(error)}`
        );
      }
    })
  );
}

export function runSafely(taskName: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    console.error(`[TerminaX] Task "${taskName}" failed`, error);
    vscode.window.showErrorMessage(
      `TerminaX: "${taskName}" failed: ${toErrorMessage(error)}`
    );
  });
}
