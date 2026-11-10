# AI Educational Book — Product TODO

Project: `ai-educational-book-windows` (Windows WPF app)
Canonical source: this folder. Current install: `%LOCALAPPDATA%\AI Educational Book`.
Owner: `/root` (current Codex task); source work is serialized through `work/01-AIEB-WIN-001.md`.
Status updated: 2026-11-10.

## Requested product roadmap

### 1. Service integrations and blog publishing — Planned
- [ ] Integrate with Only Chat's 3F Browser (Only Chat's dedicated browser) through its supported local/API contract; display truthful connection state.
- [ ] Reuse the existing Secom Career Desk web-posting system through an approved API/plugin/IPC contract. The app should hand off a finished-book post payload and display the resulting destination/status without copying or replacing Secom's publishing engine.
- [ ] Add destination selection, formatted preview, publish action/status, safe idempotent retry, and canonical post URL. Start in a test/draft destination.
- [ ] Require explicit confirmation for external publication until a clearly scoped user automation rule with visible state/stop controls exists.
- [ ] Keep credentials in the owning app or Windows-protected storage; don't copy Focus Fense, Only Chat, or Secom secrets into this app.
- [ ] Add safe retries/idempotency and show the canonical post URL/result. Keep provider credentials in Windows-protected credential storage, not source or plain-text settings.
- [ ] Verify with a private/test blog or draft-only mode before enabling live publishing.

### 2. Shareable books and synchronized files — Planned
- [ ] Decide the share format and collaboration semantics (exported EPUB/PDF/Docx vs shared editable project; who can read/edit; version conflict behavior).
- [ ] Design a portable book package with content, metadata, assets, and version history; keep local originals and backups.
- [ ] Use the user's clarification: Bluecloud sign-in is handled in FF Focus Fense. Identify its approved sync/share API, account permissions, and ownership boundary.
- [ ] Implement opt-in upload, invite/link permissions, revoke access, sync status, conflict handling, and recovery. Verify with two test accounts/devices before sharing real books.

### 3. Open-source, one-download distribution — Published v1.0.0
- [x] Establish canonical public GitHub repository, owner/org, MIT license, and release policy.
- [ ] Review dependency licenses and remove secrets/personal paths/sample private content.
- [ ] Create a reproducible one-download Windows package with installer/uninstaller, architecture/runtime requirements, checksums, and release notes; document build-from-source.
- [ ] Add CI build and clean-machine/sandbox install verification. Publish only after repository ownership and release contents are confirmed.

### 4. FF Focus Fense / Bluecloud account — Planned
- [ ] Reuse FF Focus Fense's Bluecloud account and login flow; the book app must not create a parallel account system.
- [ ] Obtain the supported handoff/status contract, API scopes, consent UX, token refresh/revocation behavior, and data-retention rules from Focus Fense's owner.
- [ ] Implement user-initiated “Connect using Focus Fense,” cancel/disconnect/status, and minimum required book sync/share scopes. Leave secrets in the owning app/OS credential store.
- [ ] Verify with a dedicated test account and two devices before uploading real books.

### 5. GitHub update prompt and download button — Planned
- [ ] Establish the official repository/release channel and signing/checksum trust policy.
- [ ] Add unobtrusive bottom-right update status/button; show current and available versions, release notes, and download progress.
- [ ] Query releases without credentials where possible; verify downloaded package against trusted signature/checksum before offering installation.
- [ ] Preserve drafts/settings/account state; block update during saves, uploads, authentication, or active chat. Provide cancel, restart-later, rollback, and visible update status.
- [ ] Test no-update, new-release, bad-checksum, interrupted-download, cancel, and rollback cases before enabling updates.

### 6. Download website and all-in-one Windows package — Published
- [x] Publish an attractive responsive download page with a real Windows x64 package link, version, installation steps, feature/status table, and transparent integration requirements.
- [x] Bundle the current self-contained Windows app, signed installer, certificate, checksums, and quick-start instructions in one ZIP; verify package integrity.
- [ ] Include all application-owned features and required runtime in the package; connect optional AI/services only through their owning apps and supported adapters.
- [ ] Do not claim the package includes all AI models or every external account service. The current AI feature is the Only Chat adapter, which uses the provider configured in Only Chat after the user connects and sends a message. Bluecloud/Secom/3F integrations require their owners' contracts.
- [x] Deploy the page/package to the official GitHub Pages/release site.

### 7. Authenticode signing — Self-signed; publisher trust not established
- [x] Sign EXE and installer with app-specific self-signed certificate; publish public certificate and thumbprint for integrity/source verification.
- [ ] Replace self-signed certificate with a CA-issued trusted code-signing certificate so Windows validates the publisher and SmartScreen trust can be established.

## Current product foundation
- [x] Windows editor/reader shell; DOCX text import; RTF save; module reload seam.
- [x] Only Chat local connector module; user-initiated messages only, read-only request mode, no saved bridge secret.
- [x] Desktop shortcut points to the current installed executable.
- [ ] User-reported first-launch failure fix has passed hidden checks and was installed, but visible open/interaction was not yet confirmed by user.

## Current task limits and safety
- User clarified: Bluecloud login belongs to FF Focus Fense; 3F Browser is Only Chat's dedicated browser; Secom Career Desk owns an existing web posting system to share. Its shortcut resolves to `C:\Users\delig\AppData\Local\Programs\secom-career-desk\Secom Career Desk.exe`; its internals remain untouched.
- The official GitHub owner/repository and release-signing trust root are unresolved. The local page/package can be prepared but public hosting/release remains pending.
- External publication, account creation, OAuth, file upload/share, public GitHub release, and update installation are not authorized by this roadmap entry; implement preview/sandbox/local flows first and use explicit user-owned actions for real external side effects.
- Source/build verification can continue in disjoint paths. Do not claim these integrations are implemented until exercised against their real service in a test account.

See `../../work/01-AIEB-WIN-001.md` for origin, ownership, checkpoints, and integration sequence.

## Implementation order and ownership
1. Prepare the local one-download Windows package and download page.
2. Obtain approved integration contracts from Focus Fense (Bluecloud), Only Chat (3F Browser), and Secom Career Desk (posting system).
3. Implement account connection and sync metadata/permissions with dedicated test accounts.
4. Implement draft/preview publishing and explicit publish confirmation for each supported blog.
5. Add share invitations, revocation, version conflict resolution, and offline sync.
6. Add the bottom-right update prompt/download/apply flow after verified releases exist.
7. Produce one signed/checksummed public bundle, verify clean install and upgrade, then publish source/release.

Task owner and exact writable paths for active changes are recorded in `../../work/01-AIEB-WIN-001.md`. The installed app process at PID 3032 is protected until its session state is known. Current checkpoint changes only this TODO, README, `.gitignore`, LICENSE, THIRD-PARTY-NOTICES, and RELEASE-CHECKLIST; there are no source edits for these planned features yet.

## Open-source signed release task (2026-11-10)
- User explicitly asked to sign the Windows build and publish it as open source.
- Project: ai-educational-book-windows; source: this folder; release candidate: `distribution/AI-Educational-Book-Windows-x64.zip`; owner `/root`.
- Preflight: GitHub CLI is authenticated to account `delight0517` with `repo` and `workflow` scopes. No git remote/repository is configured here. No code-signing certificate with a private key was found in CurrentUser/My or LocalMachine/My. Existing package is unsigned.
- Exact paths for this turn: `outputs/AI-Educational-Book/TODO.md`, `RELEASE-CHECKLIST.md`, and new public release metadata/CI files in this project root. Existing binary/package/installer/UI source remain frozen until release signing choice and signature method are established. No user personal private key or purchased certificate is present.
- Allowed action: create the official public GitHub repository for this project using authenticated `delight0517` only if exact repo name is available; create a clean source-release allowlist excluding local binaries, outputs, personal workspace paths, and user content; publish a GitHub release only with truthful “unsigned” status unless a trusted signing certificate is supplied.
- User-provided signing intent does not provide a CA-issued code-signing certificate/private key. Do not generate a self-signed cert and call it trusted Windows publisher signing. A self-signed signature may be prepared as optional integrity metadata only if explicitly useful, but won't remove SmartScreen warnings.
- Verification: inspect repository visibility, files and release assets; calculate/publish SHA-256; distinguish public source, binary release, signature, and installed app verification. No user account, cloud, or blog service side effects.
