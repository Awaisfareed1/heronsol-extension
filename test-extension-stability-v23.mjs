import fs from 'node:fs';
const bg = fs.readFileSync(new URL('./background.js', import.meta.url), 'utf8');
const sp = fs.readFileSync(new URL('./sidepanel.js', import.meta.url), 'utf8');

if (!bg.includes('const WORKFLOW_STATUSES = new Set(["ready", "generating", "completed", "downloaded", "failed"]);')) throw new Error('Missing workflow status isolation');
if (!bg.includes("status: preserveWorkflowStatus(job?.status, 'page_ready')")) throw new Error('Page Agent can still overwrite workflow status');
if (!bg.includes("pageStatus: 'navigation'")) throw new Error('Navigation is not isolated as page status');
if (!bg.includes('args: [profile, resume, autofillSettings]')) throw new Error('Autofill settings are not passed safely');
if (bg.includes('args: [profile, resume, settings, coverLetter, applicationAnswers, generatedCoverLetter]')) throw new Error('Undefined autofill variables still passed');
if (!bg.includes('autofillSettings.coverLetterFile')) throw new Error('Generated cover letter is not prepared for autofill');
if (!sp.includes('currentPageLabel') || !sp.includes('Application state is preserved.')) throw new Error('Lower status text is not dynamic');
if (!sp.includes('Resume ready')) throw new Error('Workspace lifecycle text is not dynamic');
if (!sp.includes('const currentPage=')) throw new Error('Job subheading does not follow current page');
console.log('PASS: Extension stability v2.3 regression checks');
