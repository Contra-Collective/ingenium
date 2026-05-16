# Security Policy

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security reports.**

There are two private channels:

1. **Preferred — GitHub Security Advisories.** Open a draft advisory at
   <https://github.com/ingenium/ingenium/security/advisories/new>.
   Maintainers receive a notification and the advisory remains private
   until publication.
2. **Email.** Send a description and reproduction to
   `security@ingenium.dev`. Please encrypt sensitive details if you
   have a maintainer's PGP key available.

Include in your report:

- Affected package(s) and version(s).
- A minimal reproduction (curl invocation, code snippet, or test case).
- Impact assessment — what an attacker can do, under what assumptions.
- Any mitigations / workarounds you've identified.

We will acknowledge receipt within **3 business days** and provide a
substantive response (assessment + initial remediation plan) within
**10 business days**.

## Disclosure timeline

We follow a **90-day coordinated disclosure** window from the date of
acknowledgement. This is the standard timeline used by major security
research programs (e.g. Project Zero, OSS-Fuzz).

Within the 90 days we will:

1. Validate the report and assign a severity (CVSS v3.1).
2. Develop a fix and prepare a release.
3. Coordinate with the reporter on disclosure timing.
4. Publish a security advisory and a patched release.
5. Request a CVE for high / critical severity issues.

If a fix is not feasible within 90 days we will request an extension from
the reporter and document the reasoning publicly when the issue is
disclosed.

## Supported versions

While the project is in alpha (`0.x.y-alpha`), only the latest minor
release line receives security updates. Once `1.0.0` ships, support
expands to the previous major.

| Version       | Supported          |
| ------------- | ------------------ |
| `0.1.x-alpha` | :white_check_mark: |
| `< 0.1.0`     | :x:                |

## Scope

In scope:

- The packages published from this repository
  (`ingenium`, `ingenium-compat`, `ingenium-bun`,
  `ingenium-cli`).
- The CLI and its scaffolded templates.
- Documentation that asserts security behavior (e.g. `sessionMiddleware`
  signing, `cors` defaults, `rateLimit` key generation).

Out of scope:

- Third-party packages (Zod, ws, etc.) used as peer dependencies — report
  upstream.
- The benchmark and example apps under `benchmarks/` and `examples/`,
  which are not published to npm.
- Behavior that requires a maliciously configured deployment
  (e.g. `trustProxy: true` behind no proxy, `dotfiles: 'allow'`,
  `rateLimit` with `keyGenerator: () => 'static'`).

## Acknowledgements

We credit reporters in the published advisory unless anonymity is
requested.
