# Bun migration research — 2026-09-11

Commonplace can use Bun to install dependencies and run its existing scripts. Keep Vite, TypeScript, Vitest, Playwright and their Node execution for this migration. The deployed application remains static browser assets backed by Supabase; its data model and authentication do not need changes.

Selected tooling version: Bun **1.4.2**, installed through Bun's official installer during this migration. Record `bun@1.4.2` in package-manager metadata and use `bunx bun@1.4.2 install --frozen-lockfile` / `bunx bun@1.4.2 run build` in Vercel's configuration.

## Findings and decisions

1. **Preserve dependency resolutions.** When `bun.lock` is absent, `bun install` automatically imports `package-lock.json`, preserving its resolved versions. It leaves the npm lockfile in place. Generate and inspect the text `bun.lock`, compare the resolved packages, then remove the old lockfile after verification. Commit one authoritative lockfile. [Bun migration guide](https://bun.com/guides/install/from-npm-install-to-bun-install), [lockfile documentation](https://bun.com/docs/pm/lockfile).

2. **Make installs reproducible.** Use `bun install --frozen-lockfile` for fresh checkouts and deployment. Bun documents that CI does not enable this automatically. Install development dependencies because TypeScript and Vite build the site; `--production` would omit them. A clean install is needed to reveal problems hidden by npm's existing `node_modules`. [Bun install documentation](https://bun.com/docs/pm/cli/install).

3. **Keep the existing execution model.** `bun run <script>` runs package scripts and respects Node shebangs by default; `--bun` changes that runtime. Use `bun run test` explicitly: `bun test` invokes Bun's own runner and bypasses the existing Vitest configuration. Keep `node` in the connection-check script. Node 24 remains the project's tested tooling runtime, within Playwright's documented supported versions. [Bun script execution](https://bun.com/docs/runtime), [Vitest guidance](https://vitest.dev/guide/), [Playwright requirements](https://playwright.dev/docs/intro).

4. **Let Vite load its environment.** Bun's automatic `.env` loading can put values into `process.env` before Vite handles mode-specific files. Vite explicitly documents this precedence problem. Set top-level `env = false` in `frontend/bunfig.toml`; Vite and the connection check retain their existing loading behavior, and hosted environment variables remain available. [Vite environment documentation](https://vite.dev/guide/env-and-mode), [Bun environment configuration](https://bun.com/docs/runtime/environment-variables).

5. **Review lifecycle scripts.** Bun blocks dependency lifecycle scripts except trusted packages. Omitting `trustedDependencies` uses its built-in allowlist; an explicit list replaces that allowlist, and an empty list disables dependency scripts. Before migration, the npm lockfile marks only optional macOS `fsevents@2.3.3` as having an install script. Inspect `bun pm untrusted` after installation and grant trust only if a required script needs it; do not bulk-trust dependencies. [Bun lifecycle policy](https://bun.com/docs/pm/lifecycle), [package-manager inspection commands](https://bun.com/docs/pm/cli/pm).

6. **Configure Vercel explicitly.** Vercel recognizes `bun.lock`, but the repository currently overrides installation with `npm ci` and building with `npm run build`. Change both commands. Its official exact-version recipe is `bunx bun@<version> install`; add `--frozen-lockfile`, and use the same exact-version executable for the build script. Record the selected version in `packageManager` for tooling/documentation, but do not assume that field alone pins Vercel's Bun executable. Vercel's `bunVersion` config selects its Functions runtime and currently accepts only `1.x`; it is unnecessary for this static application. [Vercel package managers](https://vercel.com/docs/package-managers), [exact Bun version recipe](https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds), [Functions runtime setting](https://vercel.com/docs/functions/runtimes/bun).

7. **Update operational commands.** Use `bun --cwd frontend run dev`, `bun --cwd frontend run test`, and equivalent build/browser commands in current documentation. Change Playwright's web-server command to `bun run dev --port 5173`. `bunx vercel@<version>` can replace the deployment CLI's `npx` launcher while retaining Node through its shebang. Keep historical progress records clearly historical. [Bun script arguments](https://bun.com/docs/runtime), [bunx behavior](https://bun.com/docs/pm/bunx).

## Migration and verification

- Select an exact available Bun version, install it, and record its version and revision.
- Migrate the lockfile without dependency upgrades; compare package names and resolved versions before removing the npm lockfile.
- Update package-manager metadata, environment-loading configuration, Vercel commands, Playwright startup and current setup instructions together.
- Perform a clean frozen install; inspect blocked scripts and confirm the lockfile stays unchanged.
- Run the existing 19 Vitest tests, production build and three browser tests, including server startup through Bun. Exercise the connection-check script without printing private environment values.
- Verify a Vercel build uses the selected Bun version and frozen install, then smoke-test the resulting deployment. Linux native dependency selection is a separate check from the local macOS build.
- Commit the migration atomically after verification. Record actual outcomes in the hosted progress log; this research note does not claim that implementation or deployment has passed.

The expected impact is on developer and deployment tooling. Faster installs or script startup are possible, but no application performance improvement is assumed without measurement.
