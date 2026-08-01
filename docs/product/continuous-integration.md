# Continuous integration

`.github/workflows/ci.yml` runs the same locked validation sequence used locally:

1. `npm ci`
2. `npm test`
3. `npm run check`
4. `npm run build`

It fires on pushes to `main` and to any `claude/**` branch, and on **every** pull request
regardless of base branch — an unfiltered `pull_request:` trigger, so a PR between two working
branches is covered rather than running nothing. The `on:` block in the workflow is the only
authoritative statement of which refs it fires on; read it rather than trusting this paragraph.

The checkout uses `fetch-depth: 0`, and that is required rather than a nicety:
`apps/server/test/docs-paths.test.ts` separates "a file this repo once had" from "a name that
never existed here" by reading `git log --all`. At the default depth of 1 that history is
invisible and the dead-path check silently passes while doing nothing, so it ships a canary that
fails loudly on a shallow clone instead.

The workflow has read-only repository permissions, a 15-minute timeout, and cancels superseded
runs on the same ref. Branch protection can require the **Test, type-check, and build** check
once the repository settings are ready for it.

**Not covered:** nothing runs on a schedule, so a repository with no commits for three months
runs these checks zero times. Rot that arrives from outside the repo — a transitive dependency, a
Node point release — is not detected until someone pushes.
