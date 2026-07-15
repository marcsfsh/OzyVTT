# Continuous integration

Every push and pull request targeting `main` runs the same locked validation sequence used locally:

1. `npm ci`
2. `npm test`
3. `npm run check`
4. `npm run build`

The workflow has read-only repository permissions, a 15-minute timeout, and cancels superseded runs on the same branch. Branch protection can require the **Test, type-check, and build** check once the repository settings are ready for it.
