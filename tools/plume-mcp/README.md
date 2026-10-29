# Plume MCP server

A small, optional [MCP](https://modelcontextprotocol.io) server that lets AI tools (Claude Desktop, Claude Code and other MCP clients) read, and optionally write, the Markdown and text files in one folder you choose.

- Local stdio only. No network calls of any kind. No dependencies.
- It is separate from the Plume app: Plume itself never touches the network for this.
- Only `.md`, `.markdown`, `.mdown`, `.mkd` and `.txt` files. Files over 2 MB are refused.
- Every path must stay inside the folder: absolute paths, drive letters, `..` and symlinks are refused.

## Run

Needs Node.js 20 or newer.

```bash
node tools/plume-mcp/server.mjs <your-folder>
```

The folder can also come from the `PLUME_MCP_ROOT` environment variable. The server refuses to start if the folder is missing or is not a directory.

## Tools

| Tool | What it does |
| --- | --- |
| `list_documents` | Lists documents (recursive, depth 6, skips dot-folders and `node_modules`) with sizes |
| `read_document` | Returns the text of one file by relative path |
| `search_documents` | Case-insensitive text search, up to 200 hits (path, line number, line) |
| `write_document` | Only with `--allow-write`. Creates a file; replacing one needs `overwrite: true`. The server cannot know whether Plume has the file open, so save or close it there first |

Add `--allow-write` only if you want the AI tool to be able to change files.

## MCP client config

```json
{
  "mcpServers": {
    "plume": {
      "command": "node",
      "args": ["<path-to-plume>/tools/plume-mcp/server.mjs", "<your-folder>"]
    }
  }
}
```

For write access add `"--allow-write"` to `args`.

## Test

```bash
node --test tools/plume-mcp/server.test.mjs
```
