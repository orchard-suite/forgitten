# Security

forgitten handles sign-ins and sends a picture of your repositories to a hub,
so a security bug matters. Please report one privately.

## Report a vulnerability

Use [private vulnerability reporting](https://github.com/orchard-suite/forgitten/security/advisories/new)
on this repository. Do not open a public issue.

Say what you found, how to reproduce it, and what an attacker gains. You will
get an answer within a week. A fix ships as a new release, and the advisory is
published once the release is out.

## What is in scope

- The CLI: what a scan reads, what a report sends, and how the sign-in is kept
  on the device.
- The hub: both surfaces, the token check on the device surface, and the web app.
- The install scripts and the release artifacts.

## How the hub is meant to be run

The session surface (port 8080) trusts identity headers from the login proxy
in front of it. Anyone who can reach that port directly can claim to be anyone.
That is by design, and a deployment that exposes it is not a vulnerability in
forgitten. [`deploy/compose.yml`](deploy/compose.yml) shows a setup where only
the proxy can reach it.

Everyone who can sign in to a hub sees and manages every device on it.
