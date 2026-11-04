# CI and maintenance

- **CI:** lint, formatting, type checks, and tests on Ubuntu and macOS.
- **CodeQL:** JavaScript/TypeScript analysis on PRs, main pushes, and weekly.
- **Dependency review:** blocks introduced high/critical vulnerabilities.
- **Dependabot:** weekly npm and GitHub Actions updates. Auto-merge is limited to verified TypeScript/Vitest patch updates after required checks pass.

Run locally with the npm version declared in `package.json`:

```sh
npm ci --ignore-scripts
npm run check
```

## GitHub setup

1. Make the repository public and enable dependency graph, Dependabot alerts/security updates, and advanced CodeQL.
2. Merge the workflows to `main` and verify quality checks, CodeQL, and dependency review.
3. Enable merge commits and auto-merge. Apply [the required-check ruleset](maintenance-ruleset.json) and block force pushes and branch deletion.
4. After validating normal and Dependabot PRs, set `CI_AUTOMERGE_ENABLED=true`.
