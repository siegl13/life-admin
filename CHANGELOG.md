# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows `0.x.y-beta` until the product is stable enough for
`1.0.0`.

## [0.1.0-beta] - Unreleased

First public beta.

### Added

- Items and Playbooks: create an Item from a bundled or custom YAML
  Playbook, or as a plain generic Item.
- Actions with due dates relative to Playbook Events, with manual
  override.
- Recurring Cycles: Playbook-driven rollover into a new cycle, previous
  cycles kept read-only.
- Owner authentication (single-owner, session-based).
- Backup and restore, download a full archive from Settings, restore it
  on a fresh or existing instance.
- Document attachments on Items (PDF, JPEG, PNG, WebP).
- Inbox: upload a document first, then route it to an existing or new
  Item.
- Optional AI-assisted document field extraction, off by default, needs
  an API key and a consent toggle.
- Optional notifications via ntfy or a Slack Incoming Webhook, off by
  default.
- Global search across Items.
- Related Items and an Item overview page.
- Human-readable history of what changed on an Item, and when.
- Reopen a completed or skipped action to put it back to open.

### Known limitations

Beta software. Take regular backups before updating. See
[README.md](README.md) for setup, backup/restore, and update
instructions.
