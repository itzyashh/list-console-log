import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  console.log('List Console Log extension activated');
  
  // Create console log tree provider
  const consoleLogProvider = new ConsoleLogTreeProvider();
  
  // Register tree view
  const treeView = vscode.window.createTreeView('consoleLogsView', {
    treeDataProvider: consoleLogProvider,
    showCollapseAll: true
  });
  
  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.refreshConsoleLogs', () => {
      consoleLogProvider.refresh();
    })
  );
  
  // Register search command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.searchConsoleLogs', async () => {
      const searchText = await vscode.window.showInputBox({
        placeHolder: 'Search console logs...',
        prompt: 'Enter text to filter console logs'
      });
      
      if (searchText !== undefined) {
        consoleLogProvider.setSearchFilter(searchText);
      }
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

  // Create a webview view provider for the search bar
  const searchProvider = new ConsoleLogSearchProvider(consoleLogProvider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('consoleLogsSearchView', searchProvider)
  );
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
  private _onDidChangeTreeData = new vscode.EventEmitter<FileNode | LogNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private fileMap: Map<string, LogNode[]> = new Map();
  private searchFilter: string = '';
  
  refresh(): void {
    this.fileMap.clear();
    this._onDidChangeTreeData.fire(undefined);
  }
  
  setSearchFilter(filter: string): void {
    this.searchFilter = filter.toLowerCase();
    this._onDidChangeTreeData.fire(undefined);
  }
  
  getTreeItem(element: FileNode | LogNode): vscode.TreeItem {
    if (element instanceof FileNode) {
      // File node with toggle
      const item = new vscode.TreeItem(
        element.fileName, 
        vscode.TreeItemCollapsibleState.Expanded  // Start expanded to show logs
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
        // Convert fileMap to array of FileNodes, filtering by search term
        const fileNodes: FileNode[] = [];
        
        this.fileMap.forEach((logs, filePath) => {
          // Filter logs based on search text
          const filteredLogs = this.searchFilter 
            ? logs.filter(log => log.text.toLowerCase().includes(this.searchFilter))
            : logs;
            
          // Only add files that have matching logs
          if (filteredLogs.length > 0) {
            const fileName = path.basename(filePath);
            fileNodes.push(new FileNode(fileName, filePath));
          }
        });
        
        // Sort by filename
        return fileNodes.sort((a, b) => a.fileName.localeCompare(b.fileName));
      });
    } else if (element instanceof FileNode) {
      // File level - return logs for this file, filtered by search term
      const logs = this.fileMap.get(element.filePath) || [];
      const filteredLogs = this.searchFilter
        ? logs.filter(log => log.text.toLowerCase().includes(this.searchFilter))
        : logs;
      
      return Promise.resolve(filteredLogs.sort((a, b) => a.line - b.line));
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

class ConsoleLogSearchProvider implements vscode.WebviewViewProvider {
  constructor(private readonly consoleLogProvider: ConsoleLogTreeProvider) {}
  
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true
    };
    
    webviewView.webview.html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { padding: 5px; }
            input { width: 100%; padding: 4px; }
          </style>
        </head>
        <body>
          <input type="text" id="searchInput" placeholder="Search console logs...">
          <script>
            const vscode = acquireVsCodeApi();
            const input = document.getElementById('searchInput');
            
            input.addEventListener('input', () => {
              vscode.postMessage({ 
                type: 'search', 
                text: input.value 
              });
            });
          </script>
        </body>
      </html>
    `;
    
    webviewView.webview.onDidReceiveMessage(message => {
      if (message.type === 'search') {
        this.consoleLogProvider.setSearchFilter(message.text);
      }
    });
  }
}