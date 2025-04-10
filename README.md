# Console Log Explorer

Easily track and navigate console.log statements in your JavaScript and TypeScript files.

## Features

This extension adds a dedicated Console Logs view in the Activity Bar, helping you:

- Quickly see all console.log statements in your open files
- Navigate directly to any console.log with a single click
- Delete console logs directly from the tree view without editing the file
- Automatically stay updated as you edit your code
- Track multiple types of console outputs (log, warn, error, info, debug)
- Support for complex console logs with objects, arrays, and multi-line statements

![Apr 10 2025 (1)](https://github.com/user-attachments/assets/181c2ec1-2eeb-4bcf-8c01-f59235b47982)

## How it works

The extension scans your currently open JavaScript and TypeScript files for console statements and organizes them in a convenient tree view:

1. Files appear as parent nodes with the number of console logs in parentheses
2. Console logs appear as child nodes with line and column information
3. Clicking on a console log takes you directly to its location in the file
4. Click the trash icon next to a console log to delete it directly

## Usage

1. Open any JavaScript or TypeScript file
2. Click the Console Logs icon in the Activity Bar
3. See all console.log statements in your open files
4. Click on any log to jump to that location in your code
5. Click the trash icon next to a log to delete it:
   - The editor will navigate to the console log
   - The console log will be highlighted before deletion
   - The log will be removed from your code
6. Use the refresh button to manually update the view

## Extension Settings

Currently, there are no configurable settings for this extension.

## Known Issues

- Very large files with many console logs may experience slight performance issues
- Multi-line console logs might not be deleted completely in some complex cases

## Release Notes

### 1.1.0
- Added ability to delete console logs directly from the tree view
- Improved detection of complex console.log statements with objects and arrays

### 1.0.0
- Initial release
- Support for JS/TS/JSX/TSX files
- Auto-refresh on file changes
- Direct navigation to console log locations

---

**Enjoy!**
