# Contributing to Life Admin

Life Admin is beta software and still small. Open an issue before a big
change so you don't build something that gets rejected.

## Code contributions

Bug reports, feature requests, and discussions are welcome.

Before submitting a substantial code contribution, please open an issue
first.

The contributor licensing model for external code contributions is
currently being finalized. Until that process is in place, external
code contributions may be discussed and reviewed but will not be merged.

## Local development

Requires Node.js 24.

```bash
npm install
npm run dev
```

Before opening a pull request, run:

```bash
npm run verify   # lint, typecheck, playbook validation, unit tests, build
npm run test:e2e # Playwright end-to-end tests (builds first)
```

Both must pass. CI runs the same commands and needs no external
credentials: tests use a fake AI provider and a fake notification
channel by default.

## Project principles

- **Smallest complete change.** Prefer a small, correct fix over a larger
  refactor, even if the larger refactor looks cleaner.
- **No domain-specific behavior in core code.** Anything that depends on how
  a specific process works (a vehicle inspection, a certificate, a contract)
  belongs in a Playbook, not in application code.
- **Playbooks are declarative data.** A Playbook is YAML: fields, dates
  ("Events"), and actions with relative due-date offsets. It cannot run
  code, fetch remote files, or schedule anything by itself.
- **Existing Items stay frozen.** When an Item is created from a Playbook,
  that Playbook's fields, events, and actions are copied into the Item.
  Later changes to the Playbook (or removing it) never change Items that
  already exist.
- **Modular monolith, no extra services.** Life Admin is one process backed
  by SQLite. Avoid introducing a job queue, a separate service, or a new
  external dependency unless there is no reasonable alternative.

## Authoring Playbooks

Playbooks are YAML data for fields, dates, and actions. They cannot run
code, include remote files, require a document, set an AI prompt, or
schedule reminders.

### Validate locally

Run `npm run playbooks:validate -- ./my-playbook.yaml` to validate exactly
one file. `npm run playbooks:validate` (no arguments) checks the bundled
playbooks.

### Vocabulary

Use `schemaVersion: 1`, an id such as `de.vehicle.insurance`, and a strict
version such as `1.2.0`. Ids use lowercase dot-separated parts. Keys use
lowercase letters, numbers, `_`, and `-`, and must not start with the
reserved `m_` or `c_` prefixes.

`fields` have `key`, `type` (`text`, `date`, or `currency`), `label`,
optional `label_i18n`, and optional `recommended`. `events` have `key`,
`label`, and a `sourceField` pointing to a date field. `actions` have
`key`, `label`, optional `description`, optional `due`, and optional
`dependsOn`.

`label_i18n` maps locale codes to alternate labels, for example
`label_i18n: { en: Insurance }`.

An action due date references an event. Its offset can contain non-zero
`years`, `months`, `weeks`, and `days` values from -600 to 600. Month
offsets clamp to the last valid day, so one month before 31 March is 28 or
29 February. Omit `offset` for the event date itself.

`carryForward` is optional on a field. If present, its boolean overrides
rollover behavior. If omitted, text values carry forward while date and
currency values reset.

### Rules and limits

At most 50 fields, 50 events, 100 actions, and 10 dependencies per action.
Field, event, and action keys are 1 to 64 characters. Labels and names are
1 to 200 characters. Descriptions are at most 2000 characters. Every
due-date offset component is an integer from -600 to 600. References must
resolve, each event source must be a date field, and action dependencies
must be acyclic. Files are limited to 128 KB.

### Example

```yaml
schemaVersion: 1
id: de.home.water-meter
version: 1.0.0
name: Water meter
label_i18n: { de: Wasserzähler }
fields:
  - key: meter_number
    type: text
    label: Meter number
    carryForward: true
  - key: reading_date
    type: date
    label: Reading date
events:
  - key: annual_reading
    label: Annual reading
    sourceField: reading_date
actions:
  - key: submit_reading
    label: Submit meter reading
    due:
      event: annual_reading
      offset: { days: -14 }
```

Check dates and legal requirements yourself. A playbook can be valid while
still containing unsuitable advice.

## Formatting and linting

`npm run lint` runs Prettier and ESLint. `npm run format` applies Prettier's
formatting automatically.

## License

Life Admin is source-available under the PolyForm Noncommercial License
1.0.0, with a separate commercial license available for commercial use.
See [`LICENSE`](LICENSE) and [`COMMERCIAL-LICENSE.md`](COMMERCIAL-LICENSE.md).
By contributing, you agree your contribution is provided under these same
terms.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
