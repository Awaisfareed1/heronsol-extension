import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("./sidepanel.js", import.meta.url), "utf8");

// Regression: when the active tab has no job/application state, renderJob()
// calls clearRenderedContext(). That path must also clear the global lower
// status message; otherwise the previous tab can leave "Tailored resume ready"
// visible on an unrelated page.
const clearStart = source.indexOf("function clearRenderedContext(){");
const renderStart = source.indexOf("function renderJob(){", clearStart);
assert.ok(clearStart >= 0, "clearRenderedContext must exist");
assert.ok(renderStart > clearStart, "renderJob must follow clearRenderedContext");
const clearBlock = source.slice(clearStart, renderStart);
assert.match(clearBlock, /status\("Ready to scan a job\."/);
assert.match(clearBlock, /state\.applicationId/);


const renderBlock = source.slice(renderStart, source.indexOf("function renderScan(){", renderStart));
assert.match(renderBlock, /!state\.applicationId\) status\("Job captured\. Generate a tailored resume to create the application workspace\."/);

// The active-tab loader must clear application/page context before asking the
// background worker for the new tab state. This prevents stale identity from
// surviving a tab switch while the asynchronous lookup is in flight.
const loadStart = source.indexOf("async function loadActiveTab(){");
const saveStart = source.indexOf("function scheduleContextRefresh(){", loadStart);
assert.ok(loadStart >= 0 && saveStart > loadStart, "loadActiveTab must exist");
const loadBlock = source.slice(loadStart, saveStart);
assert.match(loadBlock, /state\.applicationId=null/);
assert.match(loadBlock, /state\.pageContext=null/);
assert.match(loadBlock, /state\.job=r\?\.state\|\|null/);

console.log("PASS: extension status state is scoped to the active tab/application context");
