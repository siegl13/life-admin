# Agents

Rules for AI coding agents working in this repository.

## Release rules

- `docs/releasing.md` is the authoritative document for the release process.
- Never create or push a release tag without fresh explicit user approval.
- Never publish a GitHub Release without fresh explicit user approval.
- Never publish an official Life Admin container image from a developer machine.
- Candidate images use `ghcr.io/siegl13/life-admin-dev:git-<sha>`.
- Official images use `ghcr.io/siegl13/life-admin:<version>` and
  `ghcr.io/siegl13/life-admin:git-<sha>`.
- Release candidates must be built only after the final package version and
  CHANGELOG are prepared.
- `package.json` is the application version source of truth.
- Official releases must promote the exact tested candidate artifact.
- Never rebuild an accepted candidate for release.
- Never overwrite an existing immutable candidate tag.
- Prereleases must not update `latest`.
- Stable releases may update `latest`.
- GitOps/k3s deployment authority remains outside this repository.
- No cluster credentials belong in this repository.
- Do not change version, CHANGELOG, tag, or release state autonomously unless
  explicitly instructed.

## Scope and safety

- Do not commit secrets, tokens, or credentials.
- Do not commit `.env` files or personal configuration.
- Do not deploy to k3s or any production environment from this repository.
- Do not modify the private GitOps repository from this repository.

## Code style

- Follow existing conventions in the files you edit.
- Keep changes small and focused.
- Do not mix unrelated cleanups into the same change.

## Testing

- Add or update tests for every meaningful behavior change.
- Run `npm run verify` and `npm run test:e2e` before proposing changes.

## Documentation

- Update docs when changing user-facing behavior or public APIs.
- Keep documentation concise and accurate.
