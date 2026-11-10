# AI Educational Book

A Windows desktop starter for writing and reading local educational books.

## Project and license

This project is open source under the MIT License. See `LICENSE`,
`THIRD-PARTY-NOTICES.md`, and `RELEASE-CHECKLIST.md`. Public source, the download
page, and release assets are published at
https://github.com/delight0517/ai-educational-book. Build outputs are excluded
from source control; Windows binaries are distributed as versioned release assets.

## Run

Open `publish/win-x64/AiEducationalBook.exe`. It is a self-contained Windows x64 build. The app does not require sign-in or an AI provider.

To install for the current Windows account, run `Install-Windows.ps1` from this folder in PowerShell. It installs to `%LOCALAPPDATA%\AI Educational Book`, refuses a running app or unknown files in that app folder, stages the update, and retains up to two prior executable versions under `rollback`. User documents remain wherever you choose to save them.

## Current features

- Rich text writing surface with heading, bold, and italic controls.
- Open DOCX as readable/editable text, plus RTF and TXT import.
- Save drafts as RTF.
- Reading view with a contents rail, page navigation, arrow/Page Up/Page Down keys, and simple page transitions.
- Editor feature module reload with a version/hash status and an in-memory document snapshot.
- Optional Only Chat companion panel. It checks Only Chat's verified loopback endpoint and owner process, creates a new Only Chat session, and sends only messages the user presses Send on. Requests use Only Chat's read-only sandbox policy; no app task, workspace write, account login, or automatic send is initiated.
- Book context sharing is an explicit opt-in checkbox and starts off. When enabled, up to 12,000 characters of the current book text are included with the message and processed by Only Chat's selected provider.
- No account or AI connection is represented as available until a local Only Chat runtime is identity-checked.

DOCX import currently brings paragraph text into the editor and does not preserve the original Word layout. EPUB, background auto-save/recovery, document images, real page-layout pagination, Mac hosting, and app-list editing remain future work.

## Architecture and boundaries

- `MainWindow.xaml` and `MainWindow.xaml.cs`: WPF host shell and UI composition.
- `Modules/FeatureContracts.cs`: versioned feature contract, lifecycle, reload host, document session, and editor/reader modules.
- `Modules/DocxTextReader.cs`: isolated DOCX text import.
- Candidate boundary: `publish/win-x64`; user data stays outside the application binaries.

## Product roadmap

See [`TODO.md`](TODO.md) for the requested Only Chat/3F Browser integrations,
blog publishing, synced book sharing, open-source distribution, Bluecloud
account connection, and GitHub update button. “3F Browser”, the blog target(s),
and the exact Bluecloud service still need identification. Live publishing,
account creation, cloud upload, and public release have not been performed.

The current reload swaps a built-in module instance inside the running process, then restores the document snapshot. It demonstrates the lifecycle seam; it does not download or hot-load third-party binaries. Rollback here means in-process recovery if candidate module initialization fails. Installer rollback retains previous executable payloads.

The Only Chat connector reads the runtime endpoint published under `%LOCALAPPDATA%\OnlyChat`, validates the loopback URL, data directory, PID and installed executable path, then verifies `/api/health` before sending. If Only Chat is not running, the Connect button opens its known installed desktop app and waits up to 30 seconds for the local endpoint. The integration uses Only Chat's local `/api/sessions/new` and `/api/turn` routes, with `sandboxPolicy: read-only`; provider calls happen only after the user presses Send. The app does not store an Only Chat token or touch its source tree. The selected Only Chat provider may send the prompt to its configured external service, as in an ordinary Only Chat conversation.

## Build

Requires the .NET 8 SDK and Windows Desktop build support:

```powershell
dotnet publish AiEducationalBook.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish\win-x64
```

## Candidate provenance

- Source root: this folder.
- Target: Windows x64, .NET 8 WPF, self-contained single-file executable.
- Authenticode signature: self-signed app certificate. Windows does not trust this publisher by default; SmartScreen trust is not established.
- SHA-256: recorded in `Install-Windows.ps1` and `publish/win-x64/SHA256.txt`.
- Verification: Release build and self-contained publish succeeded; Authenticode status, package hashes, and release asset are tracked separately. Interactive UI behavior still needs user confirmation.

## Planned features

The requested service integrations, blog publishing, book sharing/sync, public open-source release, Focus Fense/Bluecloud account flow, and GitHub update UI are tracked in [TODO.md](TODO.md). The exact owner-app integration contracts and official release trust setup remain to be confirmed.

## Local download preview

Open `distribution/index.html` to review the responsive download page. The
`distribution/AI-Educational-Book-Windows-x64.zip` package contains the current
self-contained Windows x64 app, install script, quick-start guide, and SHA-256
manifest. The public download page is
https://delight0517.github.io/ai-educational-book/. See
`distribution/AI-Educational-Book-Windows-x64.zip.sha256` for the package checksum.
