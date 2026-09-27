import fs from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const sidepanel = fs.readFileSync(path.join(root, "sidepanel.js"), "utf8");
const agent = fs.readFileSync(path.join(root, "page-agent.js"), "utf8");

const requiredBackground = [
  'A live tab binding is authoritative while the tab exists.',
  'APPLICATION_CONTEXT_CHANGED',
  'GET_TAB_STATE',
  'applicationContextForTab',
  'activeTabId',
  'currentPageUrl'
];
for (const marker of requiredBackground) {
  if (!background.includes(marker)) throw new Error(`Missing background marker: ${marker}`);
}

for (const marker of [
  'renderWorkspace',
  'markWorkspaceRestoring',
  'APPLICATION_CONTEXT_CHANGED',
  'state.applicationId',
  'scheduleContextRefresh'
]) {
  if (!sidepanel.includes(marker)) throw new Error(`Missing sidepanel workspace marker: ${marker}`);
}

for (const marker of [
  'detectApplicationStage',
  "return 'review'",
  "return 'questions'",
  "return 'experience'",
  'applicationStage'
]) {
  if (!agent.includes(marker)) throw new Error(`Missing page-agent stage marker: ${marker}`);
}

if (background.includes('if (expectedUrl && state.pageUrl !== expectedUrl) return null')) {
  throw new Error('Background must not discard state on JD URL -> application URL transition');
}
if (background.includes('pageUrl: job.jobUrl, pageType: "application"')) {
  throw new Error('Autofill must persist the current application URL, not the original JD URL');
}

console.log('Application Workspace v2 navigation regression checks passed.');
