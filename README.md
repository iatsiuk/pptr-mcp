# pptr-mcp

MCP server for browser automation via Puppeteer. Unlike other browser MCPs that expose fixed tools (navigate, click, screenshot), this server executes arbitrary JavaScript code with direct access to the Puppeteer Browser instance.

## Key Difference

Most browser MCP servers provide a limited set of predefined actions. This approach requires multiple round-trips for complex workflows and can't handle edge cases.

**pptr-mcp** takes a different approach: it exposes a single `execute` tool that runs your JavaScript code in a Node.js VM with a `browser` global. You write Puppeteer code directly, getting full API access in one call.

```
Traditional MCP (5 round-trips)         pptr-mcp (1 round-trip)
================================        ================================

  Agent           Server                  Agent           Server
    |                |                      |                |
    |-- navigate --->|                      |-- execute ---->|
    |<-- ok ---------|                      |                |
    |                |                      |   +------------------------+
    |-- waitFor ---->|                      |   | const page = await     |
    |<-- ok ---------|                      |   |   browser.newPage();   |
    |                |                      |   | await page.goto(url);  |
    |-- click ------>|                      |   | await page.click(s);   |
    |<-- ok ---------|                      |   | await page.type(i, t); |
    |                |                      |   | return await           |
    |-- type ------->|                      |   |   page.screenshot();   |
    |<-- ok ---------|                      |   +------------------------+
    |                |                      |                |
    |-- screenshot ->|                      |<-- result -----|
    |<-- image ------|                      |                |
    |                |                      |                |
```

## Requirements

- Node.js >= 20

## Installation

```bash
npm install -g pptr-mcp
```

## MCP Configuration

Add to your MCP client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["pptr-mcp"]
    }
  }
}
```

With CLI options:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["pptr-mcp", "--no-headless", "--viewport=1080p"]
    }
  }
}
```

With custom Chrome flags (after `--`):

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": [
        "pptr-mcp",
        "--viewport=1280x720",
        "--",
        "--proxy-server=http://proxy:8080"
      ]
    }
  }
}
```

## CLI Options

| Option             | Description                                  |
| ------------------ | -------------------------------------------- |
| `--no-headless`    | Run with visible browser window              |
| `--viewport=VALUE` | Set viewport size (e.g., 1920x1080 or 1080p) |
| `--help, -h`       | Show help                                    |
| `-- [args]`        | Pass remaining args to Chrome                |

Unknown options before `--` are also passed to Chrome.

## Claude Code Plugin

Install as a Claude Code plugin:

```bash
/plugin marketplace add iatsiuk/pptr-mcp
/plugin install pptr-mcp@pptr-mcp
```

## Environment Variables

| Variable                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `CHROME_PATH`               | Path to Chrome executable                |
| `PUPPETEER_EXECUTABLE_PATH` | Alternative to CHROME_PATH               |
| `PUPPETEER_CACHE_DIR`       | Browser download cache directory         |
| `PPTR_MCP_TIMEOUT`          | Execution timeout in ms (default: 30000) |

## Tool: execute

Executes JavaScript code with access to Puppeteer browser.

### Parameters

| Name         | Type    | Default  | Description                        |
| ------------ | ------- | -------- | ---------------------------------- |
| `code`       | string  | required | JavaScript code to execute         |
| `persistent` | boolean | true     | Reuse browser session across calls |

## Recipes

### Disable headless mode

Show browser window during execution:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["pptr-mcp", "--no-headless"]
    }
  }
}
```

### Custom Chrome profile directory

Use your own Chrome profile with saved logins and cookies:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["pptr-mcp", "--", "--user-data-dir=/path/to/profile"]
    }
  }
}
```

### Use system Chrome instead of downloaded

By default, pptr-mcp downloads Chrome for Testing - a version optimized and tested for the bundled Puppeteer. To use your system Chrome instead:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["pptr-mcp"],
      "env": {
        "CHROME_PATH": "/path/to/chrome"
      }
    }
  }
}
```

## Security

This server is designed for **trusted local development** with LLM assistants (Claude Code, Cursor, etc.). The executing code comes from the LLM at your request.

### What this means

- **Not a sandbox**: The Node.js VM isolates code for convenience, not security. It is not designed to run untrusted code.
- **Full browser control**: Executed code can navigate to any URL, read page content, take screenshots, and interact with web applications.
- **Chrome runs without sandbox**: `--no-sandbox` flag is used for Docker/container compatibility.
- **Persistent sessions**: With `persistent: true` (default), cookies and browser state are preserved across calls. Use `persistent: false` for isolation.

### Not designed for

- Multi-tenant or shared server deployments
- Executing untrusted code from external sources
- Building web services that accept arbitrary user input

## License

[WTFPL](LICENSE.md)
