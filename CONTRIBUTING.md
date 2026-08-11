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
