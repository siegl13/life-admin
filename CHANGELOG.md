# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows `0.x.y-beta` until the product is stable enough for
`1.0.0`.

# Changelog

All notable changes to Life Admin will be documented in this file.

## [0.1.0-beta.1] - 2026-09-24

First public beta of Life Admin.

Life Admin is a self-hosted application for keeping important administrative
matters, deadlines, documents and multi-step processes under control.

### Added

- Action-first home view showing what needs attention next, including overdue,
  currently actionable and upcoming work.
- Items for managing administrative matters such as contracts, vehicles,
  inspections, finance topics and household maintenance.
- Declarative Playbooks for creating structured Items without hard-coding
  domain-specific behavior into the application.
- Bundled Playbooks for common Life Admin use cases.
- Custom Items and custom fields for matters that do not fit a bundled Playbook.
- Text, date and currency field types.
- Actions with dependencies, due dates, completion and skip states.
- Editable due dates for Playbook-derived Actions while keeping the original
  suggested date visible.
- Lifecycle support with cycles, history and archiving.
- Attachments for keeping relevant documents directly with an Item.
- Improved document experience with document metadata, management and viewing.
- Optional AI-assisted document extraction using OpenAI.
- AI suggestions can update existing fields or propose additional structured
  fields for explicit user review.
- Life Admin Inbox for bringing documents into the application before assigning
  them to the appropriate Item.
- Global search across Items, relevant fields, identifiers and Actions.
- Related Items for connecting administrative matters that belong together.
- Compact Item overview showing important context without replacing the full
  Item detail.
- Human-readable Item history for important changes and lifecycle events.
- Application language selection with browser detection plus explicit German
  and English overrides.
- Optional notifications using ntfy or Slack Incoming Webhooks.
- Backup and restore including attachments and application data.
- Application Settings for configuration and operational information.
- Version and Git build revision visible in the application for identifying the
  deployed artifact.

### Self-hosting

- Docker-based deployment with a simple containerized setup.
- Support for `linux/amd64` and `linux/arm64`, including Raspberry Pi and common
  home-server/NAS environments.
- SQLite-based persistent storage.
- No cloud account required for the core application.
- No telemetry required for normal operation.
- Core functionality works without OpenAI or notification services.
- Health endpoint for container and deployment monitoring.

### Playbooks

- Playbooks are declarative, versioned and validated before use.
- Existing Items keep a frozen snapshot of the Playbook version they were
  created from.
- Custom Playbooks use the same execution model as bundled Playbooks.
- Invalid custom Playbooks are isolated instead of preventing the application
  from starting.
- New cycles can selectively carry appropriate values forward while resetting
  cycle-specific information.

### Security and reliability

- Hardened Playbook parsing and schema validation.
- Protection against unsafe YAML features and malformed custom Playbooks.
- Write operations respect Item and lifecycle state.
- Archived Items remain read-only.
- Backup creation verifies referenced attachment integrity.
- Restore uses an explicit restart boundary before the restored database becomes
  active.
- Secrets are kept out of application logs, health responses and normal UI
  output.

### Beta status

This is the first public beta of Life Admin.

The application is usable for real self-hosted Life Admin workflows, but
breaking changes and migrations may still occur before a stable 1.0 release.

Regular backups are strongly recommended.

### Known limitations

Beta software. Take regular backups before updating. See
[README.md](README.md) for setup, backup/restore, and update
instructions.
