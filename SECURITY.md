# Security Policy

Life Admin (`0.1.0-beta`, pre-1.0) is built for single-owner,
single-instance self-hosting. No multi-tenant mode, and no guarantee of
safety if exposed directly to the internet without a reverse proxy and
TLS in front.

## Supported versions

Only the latest `0.1.x-beta` release. No long-term support branch yet.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository
(Security tab, "Report a vulnerability"). Don't open a public issue.

## Scope

Your data stays local: SQLite database, attachments on disk. Backups
skip stored secrets (AI provider keys, notification tokens) by design,
see "Backup and restore" in [README.md](README.md). Report it if a
backup, a log line, or an error message ever exposes a secret or
someone else's data.
