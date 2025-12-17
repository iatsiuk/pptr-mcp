# pptr-mcp

MCP server for browser automation via Puppeteer. Unlike other browser MCPs that expose fixed tools (navigate, click, screenshot), this server executes arbitrary JavaScript code with direct access to the Puppeteer Browser instance.

## Key Difference

Most browser MCP servers provide a limited set of predefined actions. This approach requires multiple round-trips for complex workflows and can't handle edge cases.

**pptr-mcp** takes a different approach: it exposes a single `execute` tool that runs your JavaScript code in a sandboxed Node.js VM with a `browser` global. You write Puppeteer code directly, getting full API access in one call.

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

With custom Chrome flags:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": [
        "pptr-mcp",
        "--window-size=1920,1080",
        "--proxy-server=http://proxy:8080"
      ]
    }
  }
}
```

## Environment Variables

| Variable                    | Description                              |
| --------------------------- | ---------------------------------------- |
| `CHROME_PATH`               | Path to Chrome executable                |
| `PUPPETEER_EXECUTABLE_PATH` | Alternative to CHROME_PATH               |
| `PPTR_MCP_TIMEOUT`          | Execution timeout in ms (default: 30000) |

## Tool: execute

Executes JavaScript code with access to Puppeteer browser.

### Parameters

| Name         | Type    | Default  | Description                        |
| ------------ | ------- | -------- | ---------------------------------- |
| `code`       | string  | required | JavaScript code to execute         |
| `persistent` | boolean | true     | Reuse browser session across calls |
