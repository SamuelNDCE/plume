# Welcome to Plume

Plume opens Markdown, text, logs, CSV, Excel and PDF files, and reads Word files. This page is a short walkthrough.

## Open a file

Press **Ctrl+O** to pick files, or **Ctrl+Shift+O** to open a whole folder. You can also drop a file on the window. Each file opens in the view that suits it: a page you type into for Markdown, a grid for CSV and Excel, a page list for PDF, a level view for logs.

## The left bar

The bar on the left holds your open files, the folders you opened, search and recent files. Press **Ctrl+Shift+F** to search every file in the open folder. The menu button at the top left has the File menu.

## The selection bar

Select some text and a one-row bar appears under it. It has a block style drop-down (Paragraph, Title, headings, Quote, Code block), Bold, Italic, Underline, Strikethrough, Code, and a text size drop-down. Press **Ctrl+/** to switch between the formatted view and the Markdown source.

## The right-click menu

Right-click the document, or press Alt+F10. The selection bar stays on top and the menu opens below it with Clipboard, Link, Quote, lists, Find and More. Menus with an arrow open on hover or with the Right arrow key.

## PDF

A PDF shows its page list on the left. Click a page, or use the keys: Down, Right and PageDown go forward one page, Up, Left and PageUp go back one page, and Home and End go to the first and last page. Type a number to jump to that page. **Ctrl+Shift+R** rotates the page, **Ctrl+P** prints, and **F1** shows every PDF shortcut. Open the edit tools to highlight, underline, add a note, draw, move or delete pages, or fill in form fields. Cover and retype puts a white box with new text over the old text. It does not change the original text, which stays in the file under the box.

## Saving

**Ctrl+S** saves and **Ctrl+Shift+S** saves under a new name. Plume keeps a file's encoding and line endings as they were. Word files are read only. Excel files can be edited and saved with Ctrl+S, but Save As has not been tested yet.

## Settings

Press **Ctrl+,** to open Settings. It has the eight themes, fonts, sizes, chart style, update options and the full shortcut list. **Ctrl+P** opens the command palette for everything else.

## A quick test

| Feature | Status |
| --- | --- |
| Tables, task lists, footnotes | yes |
| Math (KaTeX): $E = mc^2$ | yes |
| Mermaid diagrams and charts | yes |

- [x] Open a file
- [ ] Write something great

```mermaid
graph LR
  A[Open] --> B[Read] --> C[Edit] --> D[Export]
```

```chart
{"type":"bar","title":"Charts are built in","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"2025","data":[12,19,7,15]},{"label":"2026","data":[16,23,14,28]}]}
```

> Plume is MIT licensed. Make it yours.
