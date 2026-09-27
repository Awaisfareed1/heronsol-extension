# HeronSol Extension 2.3.2

## Fixed

- Fixed the global lower status message leaking from a previous tab/application into a new unrelated page.
- Reset the lower status whenever the active tab has no job/application context.
- Prevented a captured JD with no application ID from claiming that application state is preserved.
- Added a regression test covering active-tab status scoping and stale-message cleanup.

# HeronSol Extension 2.3.0

## Fixed

- Separated application workflow status from page navigation status so Page Agent and ATS URL changes cannot overwrite resume generation state.
- Fixed stale lower status text in the side panel; it now follows the current application lifecycle and page context.
- Made the Application Workspace metadata and Job subheading follow the current page/stage.
- Preserved the same application workspace when the JD URL and application URL differ.
- Fixed `coverLetter is not defined` during autofill by removing undefined injected-script arguments.
- Added generated cover letter DOCX data to the autofill payload so cover-letter file fields can be populated when a generated cover letter exists.
- Preserved existing resume, answer, scan, autofill, and cover-letter state when recapturing an already-bound application.
- Kept the localhost platform URL as `http://localhost:3000/`.

## Regression tests

- Application workspace navigation regression
- ATS field model regression
- Extension architecture regression
- Extension stability v2.3 regression
