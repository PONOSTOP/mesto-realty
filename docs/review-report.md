# Implementation review

Reviewed the implementation introduced by `86b741e..ccc1331`, its current source files, implementation plan, frontend brief, and frontend report. Read-only code review; existing test suites were not rerun. Parent verification and browser testing are separate evidence. Applied the installed security-review skill and JavaScript, authorization, authentication, injection, XSS, CSRF, upload, business-logic, and data-protection references.

## Verdict

The main specified routes and API operations are implemented with real PostgreSQL persistence. The ownership, public/private field separation, parameterized SQL, session rotation, upload content decoding, and image visibility controls are coherent. No high-confidence exploitable ownership bypass, SQL injection, stored XSS, or unintended public email/password/session disclosure was identified. This is a bounded source review, not a security certification.

All three functional findings below are resolved by the reviewed fixes. The follow-up review inspected `output/review/fixes.diff` and current `public/js/forms.js`, `public/js/core.js`, and `server/properties.js`. No substantive remaining defect was identified within this follow-up scope. Historical finding locations and explanations below describe the original code, not the corrected version.

## Resolution review

- **R1 resolved:** `public/js/forms.js:273` guards both an in-flight submission and an uncertain creation outcome. A failed initial request without a definitive response sets `createOutcomeUnknown`, explains that a draft may already exist, directs the user to the cabinet, and leaves submission disabled. The guard also prevents a manually dispatched second submit. This implements the accepted conservative recovery option; it does not claim server-side idempotency across independent requests or new page loads.
- **R2 resolved:** `server/properties.js:149` now computes `is_favorite` with a correlated EXISTS query bound to the current session user. Anonymous requests bind null and produce false. The public-property restriction remains intact.
- **R3 resolved:** `public/js/forms.js:66` captures the logout button before awaiting and restores that captured element on failure.
- **General error placement resolved:** `public/js/core.js:92` prefers the form's direct error container, preventing editor-wide errors from being placed in the nested photo error paragraph. Existing forms retain a fallback, and the editor's selected container is focusable with an alert role.
- **Minor copy/length issues resolved:** the password placeholder now says 10 characters, and city/district maxlength values now match the server's 80/100 limits. The supplied diff also rejects non-hex CSRF tokens before byte comparison, addressing the previously noted malformed-token failure.

Verification supplied by the parent, not rerun by this reviewer: Chromium browser suite 10/10 passing, including committed creation with aborted response and disabled retry, failed logout retry, lifecycle, and 390/768/1440 layouts; API suite 15/15 passing, including the related-favorite regression observed failing before its fix, production cookies, and authentication rate limits. The parent also reported an actual Node/PostgreSQL restart retaining the session, profile/avatar, and 15 properties. These results support the source-level resolution verdict.

## Original findings — resolved

### R1 — Retry after an uncertain initial save silently duplicates a draft (medium)

Location: `public/js/forms.js:306`, `public/js/forms.js:311`, `public/js/forms.js:339`; creation endpoint `server/properties.js:167`.

The editor chooses POST while `propertyId` is empty and assigns the returned id only after the request resolves. If PostgreSQL commits the INSERT but the response is lost, the catch branch restores submission controls while leaving that id empty. Retrying submits another POST and creates a second draft. Upload reconciliation only runs after `uploadStarted`, so it does not cover this earlier operation. This conflicts with the brief's explicit requirement against silent duplicate submissions.

Fix: give initial creation an idempotency key persisted with a unique owner/key constraint, or conservatively block retry after an uncertain initial creation and explain that the user must inspect the cabinet before starting again. Reproduce by dropping the first creation response after the server commits, then retrying.

### R2 — Related-property cards show incorrect favorite state (medium)

Location: `server/properties.js:149`; default in `server/property-data.js:27`; consumer `public/js/core.js:125`.

The related-properties SELECT does not fetch `is_favorite`, so `propertyView` marks every related property false even for the signed-in user's saved properties. Open a detail page whose author's other listing is already saved: its heart appears empty and the first click performs an idempotent POST instead of removing the existing favorite. Refreshing the page resets it to the same incorrect empty state.

Fix: include an EXISTS subquery bound to the session user, as already done for the main detail/list responses, and verify related cards reflect saved state and remove it in one click.

### R3 — Failed logout leaves the button disabled and throws a second error (low)

Location: `public/js/forms.js:65` and `public/js/forms.js:72`.

The logout handler accesses `e.currentTarget` in its catch block after awaiting the request. Event dispatch has ended, so `currentTarget` is null. An offline request or server rejection displays the toast but then throws a TypeError and never re-enables the button.

Fix: capture the button in a local variable before awaiting, as the detail contact handler already does. Verify offline logout can be retried after connectivity returns.

## Original minor consistency notes — resolved

- `public/js/forms.js:197` permits 120 characters for city and district; `server/validation.js:69` accepts 80 and 100 respectively. Server rejection is safe and field errors are shown, but the frontend report's claim that all length constraints match is inaccurate.
- The parent had already identified the password placeholder claiming 8 characters despite a 10-character minimum, and the CSRF comparison's character-length/byte-length mismatch. These are not new review findings. The latter fails closed with a 500 rather than bypassing CSRF.

## Positive security evidence

- Property edits/deletes and image mutations check session ownership; row locks serialize publication, deletion, and image-count changes.
- Public lists and detail use explicit columns, and public owner responses omit email and private profile phone. Listing contact disclosure is an explicitly specified separate endpoint.
- Filter values use bind parameters; SQL sort/column fragments come from fixed allowlists.
- Uploaded names are generated UUIDs, content is decoded and re-encoded to WebP, and media access checks current property visibility with no-store caching.
- Session ids rotate on authentication, cookies are HttpOnly/SameSite with production Secure, and API mutations require CSRF.
- API/user values used in templates are escaped, image URLs are restricted to local assets/media, and CSP prevents inline script execution.

The current published-edit workflow temporarily changes a listing to draft before uploading and republishing. This is disclosed in the frontend report and follows the supplied brief, so it is not reported as a new defect here.
