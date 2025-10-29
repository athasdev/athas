# Release Guide

This document explains how to create a new release of Athas.

## Quick Release

Creating a release is now as simple as running one command:

```bash
# For bug fixes (0.2.1 → 0.2.2)
bun release:patch

# For new features (0.2.1 → 0.3.0)
bun release:minor

# For breaking changes (0.2.1 → 1.0.0)
bun release:major

# Or specify an exact version
bun release -- 2.0.0
```

That's it! The script will:
1. ✅ Update version in `package.json` and `src-tauri/tauri.conf.json`
2. ✅ Show you the commits since the last release
3. ✅ Create a commit with the version changes
4. ✅ Create and push a git tag
5. ✅ Trigger GitHub Actions to build and release

## What Happens After

Once you push the tag, GitHub Actions automatically:
- Builds the app for all platforms (macOS, Windows, Linux)
- Signs the macOS app with your Developer ID
- Notarizes the macOS app with Apple
- Creates a GitHub release with all the binaries
- Generates updater artifacts

View the build progress at: https://github.com/athasdev/athas/actions

## Release Types

### Patch Release (0.2.1 → 0.2.2)
For bug fixes and minor improvements:
```bash
bun release:patch
```

Use when:
- Fixing bugs
- Making small improvements
- Updating dependencies

### Minor Release (0.2.1 → 0.3.0)
For new features that are backwards compatible:
```bash
bun release:minor
```

Use when:
- Adding new features
- Adding new settings
- Improving existing features

### Major Release (0.2.1 → 1.0.0)
For breaking changes or major milestones:
```bash
bun release:major
```

Use when:
- Making breaking changes to the API
- Removing features
- Major architecture changes
- Reaching a major milestone (1.0, 2.0, etc.)

## Manual Release (Advanced)

If you need more control, you can run the script directly:

```bash
bun scripts/release.ts patch
```

Or specify an exact version:

```bash
bun scripts/release.ts 1.2.3
```

## Prerequisites

Before creating a release, make sure:

1. **Working directory is clean**
   ```bash
   git status
   ```
   Commit or stash any changes first.

2. **All tests pass**
   ```bash
   bun check:all
   ```

3. **You're on the master branch**
   ```bash
   git checkout master
   git pull origin master
   ```

## Troubleshooting

### "Working directory is not clean"
You have uncommitted changes. Commit or stash them first:
```bash
git stash
bun release:patch
git stash pop
```

### "Permission denied"
Make sure the release script is executable:
```bash
chmod +x scripts/release.ts
```

### Build fails on GitHub Actions
Check the Actions tab for error logs:
https://github.com/athasdev/athas/actions

Common issues:
- Missing secrets (APPLE_ID, APPLE_PASSWORD, etc.)
- Rust compilation errors
- TypeScript type errors

### Release doesn't appear
- Check that the tag was pushed: `git ls-remote --tags origin`
- Check GitHub Actions ran: https://github.com/athasdev/athas/actions
- Check GitHub releases: https://github.com/athasdev/athas/releases

## GitHub Secrets Required

For proper signing and notarization, these secrets must be set:

- `APPLE_CERTIFICATE` - Base64-encoded Developer ID certificate
- `APPLE_CERT_PASSWORD` - Password for the certificate
- `APPLE_ID` - Your Apple ID email
- `APPLE_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Your Apple Developer Team ID

See `.github/workflows/release.yml` for more details.

## Release Checklist

Before releasing:

- [ ] All new features are tested
- [ ] Documentation is updated
- [ ] CHANGELOG reflects changes (optional)
- [ ] No critical bugs in the current build
- [ ] All tests pass locally
- [ ] Working directory is clean

After releasing:

- [ ] Verify GitHub Actions completed successfully
- [ ] Verify release appears on GitHub
- [ ] Test the released binaries
- [ ] Announce the release (Discord, Twitter, etc.)

## Tips

- Release early and often
- Use patch releases for quick bug fixes
- Don't wait too long between releases
- Test the release builds before announcing

## Need Help?

If you encounter issues:
1. Check GitHub Actions logs
2. Review this guide
3. Ask in the team Discord
4. Open an issue with the `release` label
