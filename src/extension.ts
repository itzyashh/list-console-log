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
  
  // Auto-refresh on document changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      // Only refresh if the document contains JS/TS code
      if (/\.(js|ts|jsx|tsx)$/.test(e.document.fileName)) {
        consoleLogProvider.refresh();
      }
    })
  );
  
  // Auto-refresh when changing files
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      consoleLogProvider.refresh();
    })
  );
  
  // Initial refresh
  consoleLogProvider.refresh();
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
    this.fileMap.clear();
    this._onDidChangeTreeData.fire(undefined);
  }
  
  getTreeItem(element: FileNode | LogNode): vscode.TreeItem {
    if (element instanceof FileNode) {
      // File node with toggle - change collapsible state based on search
      const item = new vscode.TreeItem(
        element.fileName, 
        vscode.TreeItemCollapsibleState.Expanded  // Always expanded
      );
      item.iconPath = new vscode.ThemeIcon('file-code');
      
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
      // Root level - scan for files with console.logs
      return this.scanWorkspace().then(() => {
        // Convert fileMap to array of FileNodes
        const fileNodes: FileNode[] = [];
        
        this.fileMap.forEach((logs, filePath) => {
          const fileName = path.basename(filePath);
          fileNodes.push(new FileNode(fileName, filePath));
        });
        
        // Sort by filename
        return fileNodes.sort((a, b) => a.fileName.localeCompare(b.fileName));
      });
    } else if (element instanceof FileNode) {
      // File level - return logs for this file
      const logs = this.fileMap.get(element.filePath) || [];
      
      // Sort logs by line number and return them
      const sortedLogs = [...logs].sort((a, b) => a.line - b.line);
      return Promise.resolve(sortedLogs);
    } else {
      // Log item - no children
      return Promise.resolve([]);
    }
  }
  
  private async scanWorkspace(): Promise<void> {
    // Clear previous data
    this.fileMap.clear();
    
    try {
      // Find all JS/TS files in workspace
      const files = await vscode.workspace.findFiles(
        '{**/*.js,**/*.ts,**/*.jsx,**/*.tsx}',
        '**/node_modules/**'
      );
      
      // Process each file
      for (const file of files) {
        await this.processFile(file);
      }
      
      console.log(`Found console.logs in ${this.fileMap.size} files`);
    } catch (error) {
      console.error('Error scanning workspace:', error);
    }
  }
  
  private async processFile(uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      
      // Better regex pattern that handles nested parentheses
      // This regex is more accurate for finding console.log statements
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
      
      // Only add files that have console logs
      if (logs.length > 0) {
        this.fileMap.set(uri.fsPath, logs);
      }
    } catch (error) {
      console.error(`Error processing file ${uri.fsPath}:`, error);
    }
  }
}