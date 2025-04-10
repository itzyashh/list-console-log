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
  
  // Register delete console log command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.deleteConsoleLog', async (node: LogNode) => {
      if (node) {
        try {
          // First navigate to the console log in the editor
          const document = await vscode.workspace.openTextDocument(node.uri);
          const editor = await vscode.window.showTextDocument(document);
          
          // Position the cursor at the beginning of the console log
          const line = document.lineAt(node.line);
          const consoleStartPos = new vscode.Position(
            node.line, 
            line.text.indexOf('console')
          );
          
          // Check if the console log is currently visible in the editor
          const isLogInVisibleRange = editor.visibleRanges.some(range => 
            range.contains(new vscode.Position(node.line, 0))
          );
          
          // Move cursor to the position and reveal it in the editor if not already visible
          editor.selection = new vscode.Selection(consoleStartPos, consoleStartPos);
          
          if (!isLogInVisibleRange) {
            editor.revealRange(
              new vscode.Range(consoleStartPos, consoleStartPos),
              vscode.TextEditorRevealType.InCenter
            );
          }
          
          const edit = new vscode.WorkspaceEdit();
          
          // Find the start and end positions of the console.log statement
          const startPos = consoleStartPos;
          
          // Find the closing parenthesis by tracking opening and closing parentheses
          let endLine = node.line;
          let endChar = -1;
          let parenCount = 0;
          let foundFirstOpenParen = false;
          
          // Search within the current line first
          for (let i = node.column; i < line.text.length; i++) {
            if (line.text[i] === '(') {
              foundFirstOpenParen = true;
              parenCount++;
            } else if (line.text[i] === ')') {
              parenCount--;
              if (foundFirstOpenParen && parenCount === 0) {
                endChar = i + 1; // Include the closing parenthesis
                break;
              }
            }
          }
          
          // If not found in the current line, search following lines
          if (endChar === -1 && foundFirstOpenParen) {
            let searchLine = node.line + 1;
            while (searchLine < document.lineCount && parenCount > 0) {
              const nextLine = document.lineAt(searchLine);
              const nextLineText = nextLine.text;
              
              for (let i = 0; i < nextLineText.length; i++) {
                if (nextLineText[i] === '(') {
                  parenCount++;
                } else if (nextLineText[i] === ')') {
                  parenCount--;
                  if (parenCount === 0) {
                    endLine = searchLine;
                    endChar = i + 1; // Include the closing parenthesis
                    break;
                  }
                }
              }
              
              if (endChar !== -1) {
                break;
              }
              
              searchLine++;
            }
          }
          
          // If still not found, use a fallback method
          if (endChar === -1) {
            endChar = line.text.indexOf(')', node.column);
            if (endChar === -1) {
              let searchLine = node.line + 1;
              while (searchLine < document.lineCount) {
                const nextLine = document.lineAt(searchLine);
                endChar = nextLine.text.indexOf(')');
                if (endChar !== -1) {
                  endLine = searchLine;
                  endChar += 1; // Include the closing parenthesis
                  break;
                }
                searchLine++;
              }
            } else {
              // Include the closing parenthesis
              endChar += 1;
            }
          }
          
          // Check for semicolon after the closing parenthesis
          if (endLine < document.lineCount && endChar !== -1) {
            const lineAfterParen = document.lineAt(endLine);
            if (endChar < lineAfterParen.text.length && lineAfterParen.text.charAt(endChar) === ';') {
              // Include the semicolon in the deletion range
              endChar += 1;
            }
          }
          
          if (endChar === -1) {
            throw new Error("Could not find the end of the console log statement");
          }
          
          const endPos = new vscode.Position(endLine, endChar);
          
          // Create range and highlight it before deleting
          const range = new vscode.Range(startPos, endPos);
          
          // Highlight the code that will be deleted
          editor.selection = new vscode.Selection(startPos, endPos);
          
          if (!isLogInVisibleRange) {
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            
            // Brief pause only if we had to scroll to the log
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          // Delete the text
          edit.delete(node.uri, range);
          await vscode.workspace.applyEdit(edit);
          
          // Refresh to update the tree view
          consoleLogProvider.refresh();
          
          // Show a notification
          vscode.window.showInformationMessage('Console log deleted successfully');
        } catch (error) {
          vscode.window.showErrorMessage(`Error deleting console log: ${error}`);
        }
      }
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
      
      // Add context value to enable context menu
      item.contextValue = 'logNode';
      
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