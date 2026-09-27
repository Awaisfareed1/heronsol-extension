(() => {
  const FIELD_ALIASES = {
    first_name: ['first name','given name','forename','legal first name','candidate first name'],
    last_name: ['last name','surname','family name','legal last name','candidate last name'],
    full_name: ['full name','your name','candidate name','name'],
    email: ['email','e mail','email address','candidate email'],
    phone: ['phone','mobile','mobile phone','telephone','tel','phone number'],
    linkedin_url: ['linkedin','linkedin url','linkedin profile','linkedin profile url'],
    github_url: ['github','github url','github profile','github profile url'],
    portfolio_url: ['portfolio','personal website','website','portfolio url'],
    address: ['street address','mailing address','address line 1','home address','address'],
    city: ['city','town'],
    state: ['state','province','region'],
    postal_code: ['postal code','zip','zip code','postcode'],
    country: ['country','country of residence'],
    current_employer: ['current employer','most recent employer'],
    current_title: ['current job title','most recent job title','current title'],
    work_authorization: ['work authorization','authorized to work','legally authorized','right to work'],
    sponsorship: ['sponsorship','visa sponsorship','require sponsorship','sponsor visa'],
    relocation: ['relocation','willing to relocate','open to relocation'],
    travel: ['travel','willing to travel'],
    desired_salary: ['desired salary','salary expectation','expected salary','salary requirements'],
    start_date: ['start date','available to start','availability','earliest start date'],
    source: ['how did you hear','source','referral source'],
    resume: ['resume','cv','curriculum vitae','curriculum'],
    cover_letter: ['cover letter','coverletter','letter of interest'],
    summary: ['professional summary','summary','about you','about me','introduction']
  };

  const ATS_FIELD_OVERRIDES = {
    greenhouse: { first_name: ['first_name'], last_name: ['last_name'], email: ['email'], phone: ['phone'] },
    lever: { first_name: ['name'], email: ['email'], phone: ['phone'] },
    ashby: { first_name: ['firstName'], last_name: ['lastName'], email: ['email'], phone: ['phone'] },
    workday: { first_name: ['legalNameSection_firstName'], last_name: ['legalNameSection_lastName'] },
    smartrecruiters: {},
    icims: {},
    workable: {},
    jobvite: {},
    generic: {}
  };

  function classifySite(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) return 'workday';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (host.includes('icims.com')) return 'icims';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('jobvite.com')) return 'jobvite';
    return 'generic';
  }

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function canonicalField(element, labelText = '') {
    const label = normalize(`${labelText} ${element?.getAttribute?.('name') || ''} ${element?.getAttribute?.('id') || ''} ${element?.getAttribute?.('data-automation-id') || ''}`);
    const site = classifySite(location.hostname);
    const override = ATS_FIELD_OVERRIDES[site] || {};
    for (const [field, names] of Object.entries(override)) {
      if (names.some(name => label.includes(normalize(name)))) return field;
    }
    const ranked = Object.entries(FIELD_ALIASES).map(([field, aliases]) => {
      let score = 0;
      for (const alias of aliases) {
        const a = normalize(alias);
        if (!a) continue;
        if (label === a) score = Math.max(score, 100);
        else if (label.includes(a)) score = Math.max(score, a.length > 5 ? 80 : 55);
      }
      return { field, score };
    }).sort((a,b) => b.score - a.score);
    return ranked[0]?.score >= 55 ? ranked[0].field : null;
  }

  globalThis.__HERONSOL_FIELD_MODEL__ = { version: 2, fields: FIELD_ALIASES, adapters: Object.keys(ATS_FIELD_OVERRIDES), canonicalField, classifySite };

})();
