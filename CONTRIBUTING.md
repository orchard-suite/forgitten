# Contributing

Issues and pull requests are welcome. For anything bigger than a small fix,
open an issue first so we can agree on the shape before you write it.

## Build and test

You need Node 24 or later, the .NET 10 SDK, and git.

```bash
npm install
make check
```

`make check` runs the hub's typecheck, tests, and web build, the CLI tests,
and an end-to-end test that publishes the CLI and walks a device through a
real hub. A pull request needs it green.

`npm run dev` runs the hub with no login on your own machine. See the README
for running against a stand-in for Entra.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat: ...`, `fix: ...`, `docs: ...`, or `chore: ...`, lowercase and imperative.
Releases and the changelog are built from them, so do not edit a version or
`CHANGELOG.md` by hand.

## Rules of the code

[`AGENTS.md`](AGENTS.md) lists the rules the code keeps: the CLI only reads
repositories, a remote URL never leaves the machine with credentials in it,
and every hub route needs a completed sign-in. A change that breaks one of
them will not be merged.

## Security

Report a vulnerability privately. See [`SECURITY.md`](SECURITY.md).
