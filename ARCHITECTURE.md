# HeronSol Extension Application Manager v1

## Responsibilities

- `background.js` is the application coordinator and persistence boundary.
- `page-agent.js` observes the active web page and reports navigation, ATS family, page type, and visible form metadata.
- `chrome.storage.local` stores durable tab/application bindings and URL-to-application recovery hints.
- `chrome.storage.session` stores the fast per-tab working state.
- Supabase stores the durable application extension checkpoint and event history.

## Identity rules

1. Application ID is the durable identity.
2. Tab ID is only a browser-session binding.
3. URL is page context, never the application identity by itself.
4. The page agent never creates an application from a page. It only detects context.
5. A generated application is remembered against its job URL so a new tab can recover it.

## Page agent

The page agent runs at `document_idle`, detects SPA history changes, DOM changes, and URL changes, and sends snapshots to the service worker. It is intentionally read-only: autofill remains a separate controlled operation.

Supported ATS classifications in v1:

- Greenhouse
- Lever
- Ashby
- Workday
- SmartRecruiters
- iCIMS
- Workable
- Jobvite
- Generic

## Recovery flow

```text
Tab
 -> local tabApplication:<tabId>
 -> applicationId
 -> Supabase /api/extension/applications/state
 -> restore JD/resume/template/application state
```

If the tab binding is unavailable, the extension checks its durable URL-to-application mapping before creating a new application context.


## Application Workspace v2

The extension now treats authentication and application identity as separate concerns.

- Authentication is global extension session state.
- A live browser tab has one authoritative `applicationId` binding.
- The application identity survives JD -> apply -> questions -> review URL changes.
- URL changes update page context only; they never redefine the application.
- The Page Agent reports page stage (`profile`, `experience`, `education`, `questions`, `review`).
- The side panel restores canonical state through `GET_TAB_STATE` and reacts to `APPLICATION_CONTEXT_CHANGED`.
- The Application Workspace UI displays the active application, current stage, and ATS.
- Autofill and application scans persist the current application URL as page context rather than overwriting the original JD URL.
