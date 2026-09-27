import fs from "node:fs";
import assert from "node:assert/strict";

const html=fs.readFileSync(new URL("./sidepanel.html", import.meta.url), "utf8");
const js=fs.readFileSync(new URL("./sidepanel.js", import.meta.url), "utf8");
assert.match(html,/id="stateApplicationId"/);
assert.match(html,/id="stateJdState"/);
assert.match(html,/id="stateResumeState"/);
assert.match(html,/id="status"/);
assert.match(js,/function renderStateMonitor\(\)/);
assert.match(js,/state\.applicationId\|\|state\.job\?\.applicationId/);
assert.match(js,/jobDescription\|\|j\?\.jobTitle\|\|j\?\.companyName/);
assert.match(js,/j\?\.resumeVersionId/);
assert.match(js,/renderStateMonitor\(\)/);
console.log("PASS: application ID, JD state, resume state, and bottom status are visible and synchronized");
