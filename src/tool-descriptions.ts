export const executeDescription = `Execute JavaScript in Node.js VM with Puppeteer <%= version %>.

MODES: persistent=true (default) reuses browser/session; persistent=false creates fresh isolated profile (no state leakage).
GLOBALS: browser, console.log/error/warn/info, setTimeout/clearTimeout, URL, URLSearchParams, Buffer.
RESTRICTIONS: No require/import. Return JSON-serializable data.

BEST PRACTICES:
- DISCOVER FIRST: Never guess URLs. Navigate to homepage, find links via DOM, then follow.
- VERIFY NAVIGATION: Check response.ok() after goto. On error return {status, url, screenshot}.
- COMBINE CALLS: Chain goto -> setViewport -> extract -> screenshot in single call.
- SCREENSHOT HYBRID: Screenshot for layout/nav discovery, DOM for text extraction, screenshot as fallback.
- VIEWPORT: Set page.setViewport({width:1280, height:800}) before screenshots.

ANTI-PATTERNS:
- Guessing URL patterns (/p/2, /page-2) without discovery
- Multiple calls iterating CSS selectors - screenshot instead
- Separate calls for navigation and extraction

EXAMPLE:
const [existingPage] = await browser.pages();
const page = existingPage ?? await browser.newPage();
await page.setViewport({width: 1280, height: 800});
const resp = await page.goto(baseUrl, {waitUntil: "domcontentloaded"});
if (!resp?.ok()) {
  await page.screenshot({path: "/tmp/err.jpg", type: "jpeg", quality: 85});
  return {error: resp?.status(), url: page.url(), screenshot: "/tmp/err.jpg"};
}
// find target link via DOM (prefer rel=next or visible nav text)
const link = await page.$eval('a[rel="next"]', a => a.href).catch(() => null);
if (link) await page.goto(link, {waitUntil: "domcontentloaded"});
await page.screenshot({path: "/tmp/out.jpg", type: "jpeg", quality: 85});
return {url: page.url(), title: await page.title(), screenshot: "/tmp/out.jpg"};`;
