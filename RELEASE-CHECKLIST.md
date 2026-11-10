# Public release checklist

- [x] Create/confirm the official GitHub repository and owner.
- [x] Confirm project name, public visibility, maintainers, issue policy, and release permissions.
- [ ] Review source, bundled framework notices, and all transitive licenses; generate a release-specific SBOM.
- [ ] Remove local paths, private book content, credentials, generated build files, and user-specific artifacts from version control.
- [ ] Add a clean Windows build workflow and reproducible release packaging.
- [ ] Obtain a CA-issued trusted code-signing certificate; current EXE/installer signatures are self-signed and untrusted by default.
- [ ] Test install, upgrade, rollback, and uninstall on a clean Windows account while preserving user data.
- [x] Publish source, license, notices, install instructions, checksum/signature, and release notes together (signature is self-signed; disclose this limitation).
- [ ] Configure the in-app update feed only to the verified official repository and release asset types.
- [x] Prepare and publish a responsive download page and self-contained Windows x64 ZIP with installer and SHA-256 manifest.
- [x] Confirm official GitHub repository owner and public hosting scope (`delight0517/ai-educational-book`).
- [ ] Obtain approved Focus Fense/Bluecloud, Only Chat/3F Browser, and Secom Career Desk integration contracts; don't advertise these bridges as available until the adapters work end to end.

`publish/`, `bin/`, and `obj/` are excluded from source; the reviewed release ZIP is attached only to the versioned GitHub release.
