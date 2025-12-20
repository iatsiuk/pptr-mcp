export const executeDescription = `Execute JavaScript in Node.js VM with Puppeteer <%= version %>.

MODES: persistent=true (default) reuses browser/session; persistent=false creates fresh isolated profile (no state leakage).
GLOBALS: browser, console.log/error/warn/info, setTimeout/clearTimeout, URL, URLSearchParams, Buffer.
RESTRICTIONS: No require/import. Return JSON-serializable data.

EXAMPLE:
const [existingPage] = await browser.pages();
const page = existingPage ?? await browser.newPage();
await page.goto(url, {waitUntil: "networkidle0"});
return await page.evaluate(() => document.title);

SCREENSHOT: await page.screenshot({path: "/tmp/img.jpg", type: "jpeg", quality: 85});`;
