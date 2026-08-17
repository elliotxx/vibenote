# Contributing

## Public repository safety

This repository is public. Assume that every tracked file, commit, pull request, CI log, screenshot, and release artifact can be read and copied by anyone.

Do not commit or publish:

- API keys, access tokens, passwords, cookies, private keys, signing material, or credential-bearing URLs.
- Private service hosts, intranet addresses, organization-only documentation, or internal workflow details.
- Machine-specific absolute home paths, local account names, private email addresses, or personal identifiers that are not intentionally public.
- Real notes, document exports, recovery files, backups, application-data directories, or screenshots containing personal content.
- Debug logs or test evidence copied from a real user profile.

Use synthetic data for fixtures, screenshots, examples, and runtime verification. Redact paths, account names, remote URLs, and identifiers before attaching evidence. Automated checks reduce common mistakes but cannot determine whether prose, images, or sample notes are personally sensitive; contributors and reviewers must inspect those manually.

Before committing:

```sh
npm run verify:public-safety
```

To enable the repository-managed pre-commit check in this clone:

```sh
npm run setup:hooks
```

The same checker runs in GitHub Actions and before release packaging. If a legitimate public example triggers a rule, rewrite it with placeholders or synthetic values instead of weakening the check around private data.

Project maintainers can keep a private semantic glossary outside tracked files. Configure clone-local regular expressions with repeated `git config --local --add publicSafety.blockedPattern '<pattern>'` entries, and provide the same newline-separated expressions to CI through the `PUBLIC_SAFETY_BLOCKED_PATTERNS` repository secret. Never commit the glossary itself.

## Local development

Install dependencies and start the Electron app:

```sh
npm install
npm run dev
```

If the Electron binary is unavailable, you can inspect the renderer without writing real app data:

```sh
npx vite --host 127.0.0.1 --port 3344 --strictPort
```

Without the Electron preload bridge, the browser renderer uses a localStorage mock.

## Technology

Vibenote uses Electron 41, Vue 3, Pinia, CodeMirror 6, Prettier, `@vscode/ripgrep`, and electron-builder.

## Verification

Run checks that match the changed surface. Before a release, run the complete suite:

```sh
npm run build
npm run verify:package
npm run verify:runtime
npm run verify:cli
npm run verify:cli-coordination
npm run verify:agent-cli-install
npm run verify:git-backup-export
npm run verify:git-backup-module
npm run verify:git-backup
npm run verify:stability
npm run verify:edges
npm run verify:install
npm run verify:public-safety
```

The verification suite covers package structure, DMG contents, runtime input, quit-time saving, block deletion, formatting failure safety, CLI coordination, Git snapshot export, and launching an installed app from `/Applications`.

## Commits and releases

Use Conventional Commits. Keep unrelated work out of the same commit and review the staged diff before committing.

Packaging, checksum verification, acceptance criteria, and tag publishing are documented in [RELEASE.md](RELEASE.md).
