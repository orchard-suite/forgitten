# forgitten

A CLI that finds unpushed work on a machine, and a hub that shows it for a
fleet of them. Read `README.md` first.

This repository is public and estate-neutral. Every name in a test, an
example, or a doc comes from the fixture world:
https://github.com/orchard-suite/hedge/blob/main/docs/fixtures.md.

## Shape

- `cli/Forgitten` is the CLI, in .NET.
  - `Git/` finds checkouts and reads them. `GitRunner` is the only place git
    is started. `RepoInspector` turns one repository into a `RepoReport`.
  - `Model/Report.cs` is the scan report. Its property names are the wire
    contract with the hub.
  - `Output/` prints a report. `Fleet/` signs in, reports, and installs the
    schedule.
- `src/shared` is the contract on the hub side. `model.ts` mirrors
  `Model/Report.cs`; change both together. `rules.ts` is the only place a
  reason to not be green is defined. Server and web both import it.
- `src/server` runs directly under Node 24 with no build step. Imports carry
  the `.ts` extension. Only erasable TypeScript syntax is allowed: no enums,
  no parameter properties.
  - `http.ts` builds two apps. The session app is the web app and `/api`. The
    device app is `/ingest` for the CLI.
  - `entra.ts` verifies a device's token. `report.ts` is what a device may
    send. `fleet.ts` judges stored reports at read time, so a rule change
    never needs a new report.
- `src/web` is a Vite React app served by the server from `dist/web` in
  production and proxied from the Vite dev server locally. It reads one
  endpoint, `/api/fleet`, and every page is a view of that.
- `scripts/fake-entra.ts` stands in for Entra in the server tests and in
  `scripts/e2e.sh`.

## Rules

- Nothing answers without a completed Entra sign-in except `/healthz` and
  the four files a device fetches to install the web app as an app:
  `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`, and
  `/manifest.webmanifest`. Two
  surfaces, two ports. The session port trusts the login proxy's identity
  headers. The device port trusts only an Entra access token it verified.
  Never let a header set identity on the device port, never accept a bearer
  token on the session port, and never add another route that skips either
  check.
- Only the account that joined a device may report as it, update it, or
  remove it through the device surface. Keep that check in `http.ts`.
- The CLI only reads repositories. It never fetches, never writes git
  configuration, and takes no git locks.
- A remote URL leaves the machine without credentials. Keep
  `StripCredentials` on every URL that goes into a report.
- The hub stores the latest report per device and nothing derived from it.
- Logs are JSON lines on stdout. Log both branches of any decision that
  changes what the board shows or who is let in.
- No continuously repainting CSS animations in the web app.
- `package.json` is the version of record for the hub and the CLI.
- Do not publish the CLI with `EnableCompressionInSingleFile`. `scripts/e2e.sh`
  runs the published binary and is what catches a publish setting that breaks it.

## Delivery

Agents push to main and land with `make land` (`make land BRANCH=<branch>`
from a worktree): it runs `make check`, then `release-damnit land`. CI runs
the same check on every pull request and before every release, then versions
every `feat` and `fix` since the last release tag, tags it, and builds the
tag: the image `ghcr.io/orchard-suite/forgitten:<version>` and the CLI on the
GitHub release (`forgitten-<os>-<arch>` and `SHA256SUMS`). Never edit the
version in `package.json`, `package-lock.json`, the manifest, or
`CHANGELOG.md` by hand.

## Checks

```bash
make check
```

Run it before every commit; `make land` runs it again before it pushes, and
CI runs it on every pull request and release. It needs Node 24 or later, the .NET 10 SDK, and
git.
