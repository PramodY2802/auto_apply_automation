# Browser extension (Chrome, Manifest V3)

Located in `/extension`; plain JavaScript, no build step.

## Install (unpacked)
1. In AutoApply: **Settings → Extension → Create extension token**, and copy it (it's shown once).
2. Chrome → `chrome://extensions` → enable *Developer mode* → **Load unpacked** → select the `extension` folder.
3. Click the AutoApply icon → enter the app URL (e.g. `http://localhost:3000`) and the token → **Connect**. Chrome asks for permission to contact that one origin.
4. Production: publish the extension and add its origin (`chrome-extension://<id>`) to `EXTENSION_ORIGINS`.

## What it does
| Button | Behaviour |
|---|---|
| Capture this job | Reads the schema.org `JobPosting` JSON-LD on the page (falls back to visible text) → `POST /api/v1/jobs/capture` → the job is normalized, deduplicated, scored and added to your feed |
| Fill approved answers | Fetches the prepared application for this URL (`GET /extension/prepared`) and fills **only approved** values. It skips file uploads, consent checkboxes and anything needing review, and never clicks submit |
| I submitted this application | After you submit yourself, it records the submission with any confirmation text found on the page (user-confirmed) |
| Mark this platform as signed in | Records that you have an active session on LinkedIn/Indeed/Naukri, for connection status |

## Permissions (minimal)
`storage` (app URL + token), `activeTab` + `scripting` (the content script is injected only into the tab you click on, only when you click), and an optional host permission requested for your AutoApply origin only. There are no broad host permissions, no background page scraping, and no access to cookies. The token is limited to extension endpoints and never grants access to AI keys or platform credentials.

The content script is tested in a real browser against the sandbox board (`workers/test/unit/extension-content.test.ts`): JSON-LD extraction, approved-only filling, consents left unticked, and no submission.
