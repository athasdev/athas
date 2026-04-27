# Athas Release Pipeline Hardening

This document outlines the release pipeline changes needed to make Athas releases
faster, safer, and easier to verify.

## Goals

- Produce each platform build once per release.
- Keep platform builds parallel without letting parallel jobs mutate the same
  GitHub Release.
- Publish only after all expected assets and updater metadata have been
  validated.
- Fail early when signing, notarization, credentials, or toolchain state is not
  ready.
- Make release verification repeatable from CI and from a local terminal.

## Current Risks

The current release workflow builds each target in a matrix and lets each matrix
job upload directly to the GitHub Release. That means multiple jobs can try to
create or update the same release at the same time.

This makes the release state harder to reason about because successful platform
builds, failed platform builds, updater metadata, draft release state, and asset
uploads can all interleave.

The current flow also performs expensive packaging work more than once:

- local release checks run heavy Rust and frontend validation
- release preflight builds every supported platform
- the actual release workflow builds every supported platform again

That gives good coverage, but it makes the successful release path slow and
still does not fully protect against external state failures such as notarization
agreements, missing signing credentials, or incomplete release assets.

## Proposed Release Shape

The release workflow should separate build work from release mutation.

```text
create draft release
        |
platform build matrix
        |
upload workflow artifacts
        |
download artifacts in one release job
        |
generate checksums and updater metadata
        |
upload release assets once
        |
validate release assets and latest.json
        |
publish release
        |
verify public release
```

Platform jobs should compile, sign, notarize, and package their target artifacts,
then upload those files as GitHub Actions artifacts. They should not create,
publish, or directly mutate the GitHub Release.

A single release assembly job should download the workflow artifacts, generate
shared metadata, upload all release assets, and own the transition from draft to
published release.

## Required Validation

Before a release is published, CI should verify an explicit asset manifest for
the tag. The manifest should include every supported platform and architecture,
all required signatures, the updater metadata, and checksums.

The validation step should fail if:

- an expected artifact is missing
- an unexpected duplicate release exists for the tag
- `latest.json` is missing or invalid
- `latest.json` does not reference the published tag
- `latest.json` is missing a supported platform
- a release asset URL in `latest.json` does not exist
- a required signature file is missing
- `SHA256SUMS.txt` is missing or incomplete

Publishing should only happen after this validation passes.

## Updater Metadata

Updater metadata should be generated or assembled in one place after all
platform artifacts are available.

This avoids platform jobs overwriting or partially generating `latest.json`.
The final metadata should be treated as a release artifact and validated before
publish.

The updater validation should check:

- version
- publication date
- platform coverage
- download URLs
- signatures
- JSON schema/shape

## Preflight

Preflight should become a fast readiness check instead of a duplicate full
release build.

Recommended preflight checks:

- GitHub token permissions
- required release secrets
- Apple signing identity availability
- Apple notarization credential validity
- Windows signing credential availability
- required Rust targets
- required system packages and bundling tools
- Tauri configuration parsing
- updater signing configuration
- release notes presence
- release tag/version consistency

A full six-platform package preflight can still exist as an optional manual
workflow, but it should not be required for every normal release if the actual
release workflow already builds and validates every artifact.

## Local Release Checks

Local release checks should focus on fast checks that are useful before creating
a tag:

- clean working tree
- valid semantic version
- version files stay in sync
- release notes are present
- current commit is based on the expected branch
- required CI checks are green for the release commit

Heavy compile, lint, and package checks should run continuously in CI and during
the release workflow. Running the same expensive checks locally, in preflight,
and again in release makes the release path slower without giving a clear
additional guarantee.

## Failure Handling

The release system should include a non-destructive verification and repair
path.

Recommended commands or scripts:

```text
release:verify <tag>
release:repair-plan <tag>
```

`release:verify` should report whether a release is complete and public.

`release:repair-plan` should inspect the release state and print a proposed
repair without deleting or replacing anything automatically. It should identify:

- duplicate draft releases for the same tag
- missing assets
- assets present only on draft releases
- invalid updater metadata
- checksum mismatches

Any destructive cleanup should remain explicit.

## Release Branches and Channels

Athas should keep the main development branch fast while giving releases a
stable lane.

Recommended channels:

- nightly or preview builds for packaging and updater smoke coverage
- release branches for patch lines, such as `v0.4.x`
- stable tags only after asset validation passes

This keeps packaging, signing, updater metadata, and GitHub Release behavior
exercised regularly instead of discovering release-only problems at the final
stable publish step.

## Release Notes

Release notes should be collected during development and assembled during
release preparation.

Recommended source format:

```text
Release note: Added support for editing installed skills locally.
Release note: Improved AI chat loading and activity states.
Release note: N/A
```

The final release note can then group user-visible changes by area and keep
internal infrastructure changes short.

## Rollout Plan

1. Add an explicit release asset manifest.
2. Add `release:verify` for an existing release tag.
3. Change matrix jobs to upload workflow artifacts instead of writing directly
   to the GitHub Release.
4. Add a single release assembly/upload job.
5. Generate checksums and updater metadata in the assembly job.
6. Validate all assets and updater metadata before publish.
7. Reduce regular preflight to fast readiness checks.
8. Keep full platform preflight as an optional manual workflow.
9. Add release repair planning for incomplete or duplicated release state.
10. Add preview/nightly release coverage for packaging smoke tests.

## Acceptance Criteria

- A release tag cannot publish unless all expected assets are present.
- Only one job uploads assets to the GitHub Release.
- `latest.json` is generated once and validated before publish.
- Failed signing, notarization, or credential readiness is detected before long
  platform builds whenever possible.
- Preflight no longer duplicates the full successful release build by default.
- A release can be verified after publish with one command.
- Incomplete release state can be diagnosed without manual GitHub UI inspection.
