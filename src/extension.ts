import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  console.log('List Console Log extension activated');
  
  // Create console log tree provider
  const consoleLogProvider = new ConsoleLogTreeProvider();
  
  // Register tree view
  context.subscriptions.push(
    vscode.window.createTreeView('consoleLogsView', {
      treeDataProvider: consoleLogProvider,
      showCollapseAll: true
    })
  );
  
  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.refreshConsoleLogs', () => {
      consoleLogProvider.refresh();
    })
  );
  
  // Track document changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Only refresh if the document contains JS/TS code
      if (/\.(js|ts|jsx|tsx)$/.test(e.document.fileName)) {
        consoleLogProvider.processDocument(e.document);
      }
    })
  );
  
  // Track active editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && /\.(js|ts|jsx|tsx)$/.test(editor.document.fileName)) {
        consoleLogProvider.processDocument(editor.document);
      }
    })
  );
  
  // Process all currently open documents
  vscode.workspace.textDocuments.forEach(doc => {
    if (/\.(js|ts|jsx|tsx)$/.test(doc.fileName)) {
      consoleLogProvider.processDocument(doc);
    }
  });
}

class FileNode {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string
  ) {}
}

class LogNode {
  constructor(
    public readonly text: string,
    public readonly line: number,
    public readonly column: number,
    public readonly uri: vscode.Uri,
    public readonly position: vscode.Position
  ) {}
}

class ConsoleLogTreeProvider implements vscode.TreeDataProvider<FileNode | LogNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FileNode | LogNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private readonly fileMap: Map<string, LogNode[]> = new Map();
  
  refresh(): void {
    // Process all currently open documents on manual refresh
    vscode.workspace.textDocuments.forEach(doc => {
      if (/\.(js|ts|jsx|tsx)$/.test(doc.fileName)) {
        this.processDocument(doc);
      }
    });
    
    this._onDidChangeTreeData.fire(undefined);
  }
  
  processDocument(document: vscode.TextDocument): void {
    // Skip non-JS/TS files
    if (!/\.(js|ts|jsx|tsx)$/.test(document.fileName)) {
      return;
    }
    
    // Process the document content
    this.findConsoleLogs(document);
    this._onDidChangeTreeData.fire(undefined);
  }
  
  getTreeItem(element: FileNode | LogNode): vscode.TreeItem {
    if (element instanceof FileNode) {
      // File node
      const item = new vscode.TreeItem(
        element.fileName, 
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon('file-code');
      item.description = (this.fileMap.get(element.filePath)?.length || 0).toString();
      
      // Apply custom styling for file names - make them bold and white
      item.label = {
        label: element.fileName,
        highlights: []
      };
      
      // Use ThemeColor for consistent theming
      item.tooltip = element.filePath;
      
      return item;
    } else {
      // Log node with line/column info
      const lineCol = `(${element.line + 1}:${element.column + 1})`;
      const shortText = element.text.length > 40 
        ? element.text.substring(0, 37) + '...' 
        : element.text;
        
      const item = new vscode.TreeItem(`${shortText} ${lineCol}`);
      item.iconPath = new vscode.ThemeIcon('debug-console');
      item.command = {
        command: 'vscode.open',
        arguments: [element.uri, { selection: new vscode.Range(element.position, element.position) }],
        title: 'Open File'
      };
      return item;
    }
  }
  
  getChildren(element?: FileNode | LogNode): Thenable<(FileNode | LogNode)[]> {
    if (!element) {
      // Root level - return files with console logs
      const fileNodes: FileNode[] = [];
      
      this.fileMap.forEach((logs, filePath) => {
        if (logs.length > 0) {
          const fileName = path.basename(filePath);
          fileNodes.push(new FileNode(fileName, filePath));
        }
      });
      
      // Sort by filename
      return Promise.resolve(fileNodes.sort((a, b) => a.fileName.localeCompare(b.fileName)));
    } else if (element instanceof FileNode) {
      // File level - return logs for this file
      const logs = this.fileMap.get(element.filePath) || [];
      
      // Sort logs by line number
      const sortedLogs = [...logs].sort((a, b) => a.line - b.line);
      return Promise.resolve(sortedLogs);
    } else {
      // Log item - no children
      return Promise.resolve([]);
    }
  }
  
  private findConsoleLogs(document: vscode.TextDocument): void {
    const text = document.getText();
    const uri = document.uri;
    
    // Regular expression to find console.log statements
    const pattern = /console\.(log|warn|error|info|debug)\s*\(\s*(['"`].*?['"`]|.*?)\s*\)/g;
    let match;
    const logs: LogNode[] = [];
    
    while ((match = pattern.exec(text)) !== null) {
      const method = match[1]; // log, warn, error, etc.
      const content = match[2] || '';
      
      const logText = `console.${method}(${content})`;
      const start = document.positionAt(match.index);
      
      logs.push(new LogNode(
        logText,
        start.line,
        start.character,
        uri,
        start
      ));
    }
    
    // Update the file map with found logs
    if (logs.length > 0) {
      this.fileMap.set(uri.fsPath, logs);
    } else {
      // Remove the file from the map if no logs are found
      this.fileMap.delete(uri.fsPath);
    }
  }
}