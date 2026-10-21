# Packaging, installation and release

## Artifacts

| Platform              | File                                                | Installs to                                     | Admin rights                     |
| --------------------- | --------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| Linux                 | `SkillScope-<version>-linux-x86_64.AppImage`        | Nowhere: run it directly                        | No                               |
| Linux (Debian/Ubuntu) | `SkillScope-<version>-linux-amd64.deb`              | `/opt/SkillScope` via the package manager       | Yes, to install the package only |
| Windows               | `SkillScope-<version>-windows-x64-setup.exe` (NSIS) | `%LOCALAPPDATA%\Programs\SkillScope` by default | No (per-user install)            |

Every release also ships `SHA256SUMS.txt`. The app bundles its own runtime: users need neither
Node.js nor npm.

Skill management never needs elevated rights. SkillScope writes only to user-level skill folders,
the selected workspace and its own data folder.

## Install

**AppImage**

```bash
chmod +x SkillScope-0.1.1-linux-x86_64.AppImage
./SkillScope-0.1.1-linux-x86_64.AppImage
```

Some distributions need `libfuse2` to run AppImages (`sudo apt install libfuse2` on Ubuntu 22.04+).

**Debian package**

```bash
sudo apt install ./SkillScope-0.1.1-linux-amd64.deb
```

**Windows**

Run the setup `.exe` and keep the default "Only for me" option. The installers are **not code
signed** yet, so Windows SmartScreen may warn you the first time. Check the file against
`SHA256SUMS.txt` before choosing _Run anyway_:

```powershell
Get-FileHash .\SkillScope-0.1.1-windows-x64-setup.exe -Algorithm SHA256
```

## Upgrade

Install the new version over the old one (replace the AppImage, `apt install` the new `.deb`, or
run the new Windows setup). Settings, scan history, installation receipts and backups are kept in
the data folder and survive upgrades:

| Platform | Data folder            |
| -------- | ---------------------- |
| Linux    | `~/.config/SkillScope` |
| Windows  | `%APPDATA%\SkillScope` |

The database is migrated automatically on first start (`PRAGMA user_version`). If it is
unreadable, SkillScope keeps a `skillscope.db.corrupt-<timestamp>` copy and starts fresh. Your
skills are never stored in the database, so nothing on disk is lost.

## Uninstall

Uninstalling the app does **not** remove skills you installed with it, and the Windows
uninstaller keeps the data folder. To remove skills first, use **Installations → Remove** for each
one, then uninstall.

## Building locally

```bash
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run package          # builds for the current OS
npm run verify:release   # checks artifacts, asar contents, fuses; runs the packaged self-check
```

`npm run package -w @skillscope/desktop -- --win` cross-builds the Windows installer from Linux
only when Wine is available. CI builds each platform on its own runner instead.

### What `verify:release` checks

1. The expected installers exist.
2. `app.asar` contains the bundled main, preload and renderer, with no `node_modules` and no
   source maps (the runtime is fully bundled).
3. The Electron fuses are set: `RunAsNode`, `NODE_OPTIONS` and inspector flags off, and the app
   loads only from `app.asar`.
4. With `--smoke`, the packaged executable starts against a fixture home directory, confirms the
   renderer has no Node.js access and the preload bridge works, scans, and exits with a report.
5. It writes `SHA256SUMS.txt`.

## Release process

1. Update the version in `apps/desktop/package.json` and `docs/release-notes.md`.
2. Commit, then tag: `git tag v0.1.1 && git push origin v0.1.1`.
3. The **Release** workflow builds and verifies on `ubuntu-latest` and `windows-latest`, then
   creates a **draft** GitHub release with the installers and combined checksums.
4. Review the draft and publish it.

## Platform verification status

| Check                                              | Linux                               | Windows |
| -------------------------------------------------- | ----------------------------------- | ------- |
| Unit and engine tests                              | Run locally and in CI               | CI only |
| End-to-end tests (Playwright + Electron)           | Run locally and in CI               | CI only |
| AppImage and `.deb` build plus packaged self-check | Run locally (Ubuntu, x64) and in CI | n/a     |
| NSIS installer build plus packaged self-check      | n/a                                 | CI only |

Development happened on Linux. Windows behaviour is covered by the Windows CI job; until that
job has passed for a given commit, treat Windows as **not yet verified** for that commit.
