# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.1](https://github.com/orchard-suite/forgitten/compare/v0.1.0...v0.1.1) (2026-10-03)


### Features

* change scanned paths without a new sign-in ([4ba4864](https://github.com/orchard-suite/forgitten/commit/4ba48640704d232bd00f3d828c68a7f9cc2f1442))


### Bug Fixes

* make the cookie secret url-safe base64 ([c1499bd](https://github.com/orchard-suite/forgitten/commit/c1499bdf8ec899e388946ce8b13115c8e1d9d981))

## [1.0.0](https://github.com/orchard-suite/forgitten/compare/v0.1.9...v1.0.0) (2026-11-23)

### ⚠ BREAKING CHANGES

* **forgitten:** open the source in orchard ([6091a46](https://github.com/orchard-suite/forgitten/commit/6091a46d1ba942bc82f024709403620acf930c18))

### Features

* **forgitten:** open the source in orchard ([6091a46](https://github.com/orchard-suite/forgitten/commit/6091a46d1ba942bc82f024709403620acf930c18))

## [0.1.9](https://github.com/orchard-suite/forgitten/compare/v0.1.8...v0.1.9) (2026-11-10)

### Features

* **forgitten:** install the hub as an app with its icon ([39a5ae2](https://github.com/orchard-suite/forgitten/commit/39a5ae2093f65fece2aa5f5d1426b187a2a81177))

## [0.1.8](https://github.com/orchard-suite/forgitten/compare/v0.1.7...v0.1.8) (2026-11-02)

### Bug Fixes

* sign the image and attest its sbom ([889704e](https://github.com/orchard-suite/forgitten/commit/889704ee3038ea4a44be89d9dd334f53e0b5f1bc))

## [0.1.7](https://github.com/orchard-suite/forgitten/compare/v0.1.6...v0.1.7) (2026-10-28)

### Bug Fixes

* keep long repo lines inside their cards ([42e0979](https://github.com/orchard-suite/forgitten/commit/42e0979cc8a207a342bf1424e26eb97c990980f5))

## [0.1.6](https://github.com/orchard-suite/forgitten/compare/v0.1.5...v0.1.6) (2026-10-21)

### Bug Fixes

* retry a hub that cannot be reached at first ([1dab47b](https://github.com/orchard-suite/forgitten/commit/1dab47bdbdbfb2da7e4c0ee0f9999db05fd881c6))

## [0.1.5](https://github.com/orchard-suite/forgitten/compare/v0.1.4...v0.1.5) (2026-10-21)

### Bug Fixes

* keep one schedule per config directory ([a4f020e](https://github.com/orchard-suite/forgitten/commit/a4f020e211a0439f603681264500afe12e38f7d7))

## [0.1.4](https://github.com/orchard-suite/forgitten/compare/v0.1.3...v0.1.4) (2026-10-21)

### Bug Fixes

* run the mac schedule as a system daemon ([0028709](https://github.com/orchard-suite/forgitten/commit/00287099a8d3f803d517beaf4e8f2a9d99ee9fcb))

## [0.1.3](https://github.com/orchard-suite/forgitten/compare/v0.1.2...v0.1.3) (2026-10-21)

### Features

* install the schedule when a device joins ([9a89c88](https://github.com/orchard-suite/forgitten/commit/9a89c88b71df8fda3c684cc31518d57aa1c2abb8))

## [0.1.2](https://github.com/orchard-suite/forgitten/compare/v0.1.1...v0.1.2) (2026-10-21)

### Features

* add a compose file for running a hub ([1316684](https://github.com/orchard-suite/forgitten/commit/1316684cfa36f9dcaf7bdea781b41a1277274ba9))

### Bug Fixes

* check each cli download against release checksums ([e436fd3](https://github.com/orchard-suite/forgitten/commit/e436fd3b83723d864fd96088e5bc0977d788ce33))
* refuse to send sign-in tokens over plain http ([f394b88](https://github.com/orchard-suite/forgitten/commit/f394b88da2efad4d417fdf5c0a9a0eaaeeb946a2))

## 0.1.0 (2026-10-02)


### ⚠ BREAKING CHANGES

* scan for unpushed work, report to a hub

### Features

* add the fleet hub web app ([04765e7](https://github.com/orchard-suite/forgitten/commit/04765e74bdae00d966bd1a03199f9c8b80af81fd))
* better default output ([e42981a](https://github.com/orchard-suite/forgitten/commit/e42981af9326326c1a4ac979c1fbebd393a42c7a))
* convert to cli ([710778c](https://github.com/orchard-suite/forgitten/commit/710778c960e419a4eb6d859f0149748ebcda8acb))
* create app ([87e7525](https://github.com/orchard-suite/forgitten/commit/87e75252c6b10b3c55e8c1c7fea493be720b372b))
* publish cli binaries on release ([2addf36](https://github.com/orchard-suite/forgitten/commit/2addf36174c5c62251b59d52616555d337e5ab4c))
* scan for unpushed work, report to a hub ([dbc6847](https://github.com/orchard-suite/forgitten/commit/dbc6847f7cf9ec20d8999d8e9c3fc8d6695e9ac0))
* support json or text output ([d525307](https://github.com/orchard-suite/forgitten/commit/d5253073b4a73dc460aa91bebe31296b6c460df6))
* tabulate output ([6461b71](https://github.com/orchard-suite/forgitten/commit/6461b71e3f20b43b932f85bd0a746e4585818cc5))
* update json payload formatting ([e1a2c61](https://github.com/orchard-suite/forgitten/commit/e1a2c6176c9d384fc01440335acb316202ac3918))


### Bug Fixes

* handle path and io errors in directory scan ([10fe711](https://github.com/orchard-suite/forgitten/commit/10fe71167787b93670913c388a80ac7c9e57ac3f))
* read the file mode on linux in the e2e test ([129ff1e](https://github.com/orchard-suite/forgitten/commit/129ff1eb6af5b057cfbea42db2de3bbd6ce27366))

## 0.1.0

The hub, and a CLI that can report to it.

- A web app that shows every device in the fleet, the repositories on each,
  and what on them has not been pushed. Behind Microsoft Entra sign-in for
  browsers and for devices.
- `forgitten fleet join`, `report`, `status`, `leave`, and `agent install` to
  add a device and keep it reporting.
- The scan now counts commits no remote holds, per branch, instead of
  comparing against `origin/<branch>`. It reports ahead and behind counts,
  deleted upstreams, stashes, linked worktrees, detached checkouts, and
  repositories before their first commit.
- `--json` prints the full report. Its shape changed.
- The scan no longer adds every repository to the global `safe.directory`
  list and no longer follows links in a loop.
- Releases carry the CLI for macOS, Linux, and Windows, which the install
  scripts expect.
