# HeronSol Extension 2.2.0

## Application Workspace v2

- Separates global authentication from application identity.
- Keeps one application ID authoritative for a live browser tab across URL changes.
- Adds runtime context refresh from the background service worker to the side panel.
- Adds an Application Workspace header showing application, ATS, and current page stage.
- Adds Page Agent stages for profile, experience, education, questions, and review.
- Prevents JD URL from being written as the current application page after scanning/autofill.
- Restores tab state through the canonical `GET_TAB_STATE` path.
- Keeps durable application URL mappings while cleaning live tab bindings when tabs close.
- Adds navigation regression tests.
