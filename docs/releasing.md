# Releasing Life Admin

Life Admin follows a build-once, promote-after-validation release process.

Build the candidate image once. Deploy it to staging. If it passes acceptance,
promote that exact artifact to an official GHCR image and GitHub Release.
Never rebuild an accepted candidate for release.

## Release principles

- **Build once.** The candidate image built for staging is the same image
  promoted to an official release.
- **Immutable artifacts.** Registry tags are never overwritten. A failed
  candidate gets a new SHA, a new tag, a new deployment.
- **Promote the exact tested candidate.** The official release must
  reference the same bytes validated in staging.
- **Main should remain releasable.** Every commit on `main` should be able
  to become a release candidate.

## Prerequisites

- `main` CI is green.
- A `buildx` builder exists that supports `linux/amd64,linux/arm64`
  (e.g. `docker buildx create --name life-admin --use --bootstrap`).
- GHCR authentication is configured (`docker login ghcr.io`).
- Access to the private GitOps repository / Argo CD staging environment.
- No unresolved release blockers.

## 1. Prepare release

1. Choose the target version (e.g. `0.1.0-beta.1`).
2. Create a release preparation branch from `main`.
3. Update `package.json` version to the target version.
4. Run `npm install` to update `package-lock.json` consistently.
5. **Finalize the CHANGELOG:**
   - Move relevant "Unreleased" content into a new section with the target
     version.
   - Add the release date when appropriate.
   - Include user/admin-facing changes, not raw commit messages.
6. Open a PR against `main`.
7. Pass all Quality Gates (see below).
8. Merge to `main`.

## 2. Build candidate

The candidate is automatically built and pushed to GHCR after every successful
merge to `main`. The CI workflow (`.github/workflows/ci.yml`) runs the
`candidate` job after the `verify` quality gate passes.

This produces:

```
ghcr.io/siegl13/life-admin-dev:git-<12-char-sha>
```

Only immutable `git-<sha>` tags are used for candidates. No `latest`, no
semantic version tags, no floating prerelease tags.

The candidate build is idempotent: if the exact tag already exists, the
workflow skips rebuilding and verifies the existing artifact.

For local or ad-hoc testing, you can also build manually:

```bash
./scripts/push-test-image.sh
```

## 3. Deploy candidate to staging

1. Update the private GitOps repository to the exact candidate image:

   ```yaml
   image: ghcr.io/siegl13/life-admin-dev:git-<sha>
   ```

2. Argo CD syncs the change to the k3s staging cluster.
3. Wait for the deployment to become ready.

The Life Admin repository does not contain k3s credentials. Deployment
remains a GitOps concern.

## 4. Acceptance gate

Verify the candidate in staging:

- [ ] Deployment is healthy (Argo CD shows synced and healthy).
- [ ] `/healthz` returns `{"status":"ok"}` (or `{"status":"ok"}` with
      extended info for authenticated owner).
- [ ] Database started cleanly, migrations applied.
- [ ] Owner login / setup page works as expected.
- [ ] What's Next page loads with correct overdue/upcoming items.
- [ ] Creating a new Item from a Playbook works.
- [ ] Opening an existing Item shows fields, actions, and dates.
- [ ] Global search returns results.
- [ ] Document attachments can be uploaded and viewed.
- [ ] Related Items and Item overview page work.
- [ ] Change history displays correctly.
- [ ] Backup download is available and produces a valid ZIP.
- [ ] Application logs show no obvious failures.
- [ ] Settings → System shows the expected Version and Build revision
      (matching `package.json` version and the image's baked-in Git SHA).

## 5. If acceptance fails

1. Fix the issue through a normal PR against `main`.
2. Merge to `main`.
3. A new candidate is automatically built with a new SHA.
4. Deploy the new candidate to staging.
5. Run the acceptance gate again.

Never overwrite an existing candidate tag. Each candidate has its own
immutable `git-<sha>` reference.

## 6. Approve release

Once staging acceptance passes:

1. Verify the exact tested commit is on `main`.
2. Create a protected Git tag on that commit:

   ```bash
   git tag v0.1.0-beta.1
   git push origin v0.1.0-beta.1
   ```

Creating and pushing the tag is the explicit human release approval. No
release is published without this deliberate step.

## 7. Release workflow

Pushing a version tag (`v*`) triggers `.github/workflows/release.yml`, which:

1. **Validates:**
   - Tag points to the workflow commit.
   - Tagged commit is reachable from `main`.
   - Tag format matches semantic versioning with optional prerelease suffix.
   - Stripped tag version matches `package.json` version.

2. **Verifies candidate exists:**
   - Checks that the candidate image exists in GHCR:
     `ghcr.io/siegl13/life-admin-dev:git-<sha>`
   - Records the candidate digest.

3. **Promotes the exact candidate (NO rebuild):**
   - Copies the OCI artifact from the candidate package to the official
     package using `regctl image copy`.
   - Tags:
     - `ghcr.io/siegl13/life-admin:<version>` (e.g. `0.1.0-beta.1`)
     - `ghcr.io/siegl13/life-admin:git-<sha>`
   - For stable releases only: additionally creates
     `ghcr.io/siegl13/life-admin:latest`.
   - OCI labels are inherited from the candidate.

4. **Verifies digest equality:**
   - Confirms that the source candidate digest matches all promoted tags.
   - If digests differ, the workflow fails and no GitHub Release is created.

5. **Creates GitHub Release:**
   - Only after promotion and digest verification succeed.
   - Uses generated release notes.
   - Prerelease versions are marked as GitHub Pre-release.

If any step fails, the workflow fails. No GitHub Release is created if
promotion fails.

**Important:** The release workflow does NOT run `docker build`. It promotes
the exact tested candidate artifact.

## 8. Verify release

After the workflow completes:

- [ ] GitHub Actions release workflow succeeded.
- [ ] Official GHCR image exists:
      `ghcr.io/siegl13/life-admin:<version>`
- [ ] Image version and revision are correct.
- [ ] GitHub Release exists at the expected URL.
- [ ] Prerelease flag is set correctly (pre-release for beta, normal for
      stable).
- [ ] No unintended `latest` tag for prereleases.

## 9. Own-production deployment (optional)

After the official release is verified, the GitOps repository may switch from
the private candidate to the official image:

```yaml
image: ghcr.io/siegl13/life-admin:0.1.0-beta.1
```

Deployment remains a GitOps concern. The Life Admin repository does not
deploy to k3s directly.

## 10. First release example

For the first release, use a prerelease version:

- `package.json` version: `0.1.0-beta.1`
- Git tag: `v0.1.0-beta.1`

This exercises the full flow without marking a stable release.

The CHANGELOG currently has an "Unreleased" section for `0.1.0-beta`. When
preparing this release, rename it to `0.1.0-beta.1` and add the release date.

---

## Quality Gates

### Pre-merge quality gate (PR → main)

Technical validation before any code reaches `main`:

- `npm run lint` — Prettier formatting and ESLint rules.
- `npm run check` — Svelte type checking.
- `npm run playbooks:validate` — Playbook schema validation.
- `npm run test:unit` — Unit / integration tests (Vitest).
- `npm run build` — Production build.
- `npm run test:e2e` — Playwright end-to-end tests.
- Docker verification — amd64 build on every push/PR, amd64+arm64 build on
  main.
- CODEOWNERS review — `@siegl13` for all files.
- Required GitHub status checks — PR cannot merge without green CI.

### Candidate publication (automatic on main)

After `verify` passes on `main`:

- Multi-platform build: `linux/amd64,linux/arm64`.
- Push to private package: `ghcr.io/siegl13/life-admin-dev:git-<sha>`.
- Idempotent: skips if exact tag already exists.
- Records OCI digest for traceability.
- Requires `packages: write` permission.

### Staging acceptance gate

Validation of the actual candidate artifact in the k3s staging environment
(section 4 checklist above).

### Release approval

The explicit human decision to release, expressed by creating and pushing the
protected Git tag.

---

## Versioning

- `package.json` is the application version source of truth.
- `package-lock.json` must match after `npm install`.
- The final release version is set BEFORE building the release candidate.
- The application UI displays Version (from `package.json`) and Build
  (Git revision baked into the image at build time).
- Candidate and official promoted images expose the same version and build.

The Docker registry tag is not the runtime source of truth.

---

## Package distinction

### Private / test package

`ghcr.io/siegl13/life-admin-dev`

- Candidate and local/k3s testing.
- Private package.
- Immutable `git-<sha>` tags only.
- Example: `ghcr.io/siegl13/life-admin-dev:git-abc123def456`

Do NOT use `latest`, `beta`, or semantic version tags for this package.

### Official release package

`ghcr.io/siegl13/life-admin`

- Public official releases.
- Prerelease: `life-admin:0.1.0-beta.1` + `life-admin:git-<sha>`
- Stable: `life-admin:1.0.0` + `life-admin:git-<sha>` + `life-admin:latest`
- Official images are produced only by GitHub Actions, never locally.

---

## GitOps / k3s boundary

The Life Admin repository:

- Builds artifacts and publishes them to GHCR.
- Does NOT deploy directly to k3s.
- Does NOT contain k3s or Argo CD credentials.

The private GitOps repository:

- Owns the desired deployment state.
- References the exact candidate or release image.
- Is reconciled by Argo CD, which pulls the desired state into k3s.
