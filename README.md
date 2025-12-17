# pptr-mcp

MCP server for browser automation via Puppeteer. Unlike other browser MCPs that expose fixed tools (navigate, click, screenshot), this server executes arbitrary JavaScript code with direct access to the Puppeteer Browser instance.

## Key Difference

Most browser MCP servers provide a limited set of predefined actions. This approach requires multiple round-trips for complex workflows and can't handle edge cases.

**pptr-mcp** takes a different approach: it exposes a single `execute` tool that runs your JavaScript code in a sandboxed Node.js VM with a `browser` global. You write Puppeteer code directly, getting full API access in one call.

```
Traditional MCP:          pptr-mcp:
1. navigate(url)          1. execute(`
2. waitForSelector(s)        const page = await browser.newPage();
3. click(selector)           await page.goto(url);
4. type(input, text)         await page.click(selector);
5. screenshot()              await page.type(input, text);
                             return await page.screenshot();
                          `)
```

## Installation

```bash
npm install
npm run build
```

## MCP Configuration

Add to your MCP client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "node",
      "args": ["/path/to/pptr-mcp/dist/cli.js"]
    }
  }
}
```

With custom Chrome flags:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "node",
      "args": [
        "/path/to/pptr-mcp/dist/cli.js",
        "--window-size=1920,1080",
        "--proxy-server=http://proxy:8080"
      ]
    }
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CHROME_PATH` | Path to Chrome executable |
| `PUPPETEER_EXECUTABLE_PATH` | Alternative to CHROME_PATH |
| `PPTR_MCP_TIMEOUT` | Execution timeout in ms (default: 30000) |

## Tool: execute

Executes JavaScript code with access to Puppeteer browser.

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `code` | string | required | JavaScript code to execute |
| `persistent` | boolean | true | Reuse browser session across calls |

### Response Format

```typescript
// Success
{
  success: true,
  result: any,      // returned value (must be JSON-serializable)
  logs: []          // captured console.log/error/warn/info calls
}

// Error
{
  success: false,
  error: string,
  details: {
    type: "syntax" | "runtime" | "timeout" | "launch",
    stack?: string,
    suggestion?: string
  },
  logs: []
}
```

### Available Globals

- `browser` - Puppeteer Browser instance
- `console.log/error/warn/info` - captured in response
- `setTimeout/clearTimeout` - standard timers

### Restrictions

- `require`/`import` not available (sandboxed VM)
- Return value must be JSON-serializable
- Pages created during execution are auto-closed

## Examples

### Basic Navigation

```javascript
const page = await browser.newPage();
await page.goto('https://example.com');
return await page.title();
```

### Screenshot

```javascript
const page = await browser.newPage();
await page.goto('https://example.com');
const path = '/tmp/screenshot-' + Date.now() + '.png';
await page.screenshot({ path });
return { screenshot: path };
```

### Form Interaction

```javascript
const page = await browser.newPage();
await page.goto('https://example.com/login');
await page.type('#username', 'user');
await page.type('#password', 'pass');
await page.click('button[type="submit"]');
await page.waitForNavigation();
return await page.url();
```

### Extract Data

```javascript
const page = await browser.newPage();
await page.goto('https://news.ycombinator.com');
return await page.$$eval('.titleline > a', links =>
  links.slice(0, 10).map(a => ({ title: a.textContent, href: a.href }))
);
```

### PDF Generation

```javascript
const page = await browser.newPage();
await page.goto('https://example.com', { waitUntil: 'networkidle0' });
const pdf = await page.pdf({ format: 'A4' });
const path = '/tmp/page-' + Date.now() + '.pdf';
require('fs').writeFileSync(path, pdf); // won't work - no require
// Instead, use page.pdf({ path }) directly:
await page.pdf({ format: 'A4', path: '/tmp/page.pdf' });
return { pdf: '/tmp/page.pdf' };
```

### Persistent vs Non-Persistent Mode

```javascript
// persistent: true (default)
// - Faster: reuses running browser
// - State persists: cookies, localStorage, cache
// - Good for: multi-step workflows, authenticated sessions

// persistent: false
// - Clean slate each call
// - No state leakage between calls
// - Good for: isolated scraping tasks, testing
```

## Development

```bash
npm run build    # build (runs format, lint, test first)
npm run test     # run tests
npm run lint     # eslint
npm run format   # prettier
```

## License

MIT
