import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./ats-adapters.js', import.meta.url), 'utf8');
const context = { location: { hostname: 'boards.greenhouse.io' } };
vm.createContext(context);
vm.runInContext(source, context);
const model = context.__HERONSOL_FIELD_MODEL__;
if (!model || model.version !== 2) throw new Error('Field model did not initialize');
const fake = (name, id='') => ({ getAttribute: (a) => ({name,id}[a] || '') });
const cases = [
  ['First Name','first_name'],
  ['Legal Last Name','last_name'],
  ['Email Address','email'],
  ['Mobile Phone','phone'],
  ['LinkedIn Profile URL','linkedin_url'],
  ['Resume / CV','resume'],
  ['Cover Letter','cover_letter'],
  ['Work Authorization','work_authorization'],
  ['Desired Salary','desired_salary']
];
for (const [label, expected] of cases) {
  const got = model.canonicalField(fake('', ''), label);
  if (got !== expected) throw new Error(`${label}: expected ${expected}, got ${got}`);
}
console.log(`ATS field model checks passed: ${cases.length}`);
