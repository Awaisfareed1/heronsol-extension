import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const required = ['manifest.json', 'background.js', 'page-agent.js', 'sidepanel.js'];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing extension file: ${file}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Extension must use Manifest V3');
if (!manifest.content_scripts?.some((entry) => entry.js?.includes('page-agent.js'))) throw new Error('page-agent.js is not registered');
if (!manifest.permissions?.includes('storage') || !manifest.permissions?.includes('tabs') || !manifest.permissions?.includes('scripting')) throw new Error('Required extension permissions are missing');

const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'page-agent.js'), 'utf8');
for (const marker of [
  'TAB_APP_PREFIX',
  'applicationContextForTab',
  'bindApplicationToTab',
  'rememberApplication',
  'PAGE_AGENT_SNAPSHOT',
  'GET_APPLICATION_CONTEXT',
  'BIND_APPLICATION_TO_TAB',
  '/api/extension/applications/state',
  'PAGE_CHANGED'
]) {
  if (!background.includes(marker)) throw new Error(`Background architecture marker missing: ${marker}`);
}
for (const marker of ['PAGE_AGENT_READY', 'MutationObserver', 'history.pushState', 'detectPageType', 'greenhouse.io', 'lever.co', 'ashbyhq.com']) {
  if (!agent.includes(marker)) throw new Error(`Page-agent marker missing: ${marker}`);
}
console.log('Extension application-manager/page-agent architecture checks passed.');
