# Repository Instructions

## Public repository safety

Treat every tracked file, commit, pull request, build log, screenshot, and release artifact as public.

- Follow the public-safety rules in [CONTRIBUTING.md](CONTRIBUTING.md) before committing or publishing changes.
- Never commit credentials, private keys, private service URLs, machine-specific home paths, real user notes, recovery data, backups, or screenshots containing personal content.
- Use synthetic fixtures and redacted evidence for tests and documentation.
- Run `npm run verify:public-safety` before handoff. If any content may be private and cannot be verified safely, stop and request a sanitized substitute.
