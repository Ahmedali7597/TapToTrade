# Security policy

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately through [GitHub's private vulnerability reporting](https://github.com/Ahmedali7597/TapToTrade/security/advisories/new) instead.

Include what you found, the steps to reproduce it and the impact you expect. I aim to reply within a week and will keep you updated until it's fixed.

## Scope

This covers the code in this repository and the live site at [taptotrade.ca](https://taptotrade.ca).

- Test against a local copy wherever you can. The read-only `npm run test:security` checks are safe to run against the live site.
- Don't run automated scanners or load tests against taptotrade.ca.
- Never access, change or delete other players' accounts or data.

## Supported versions

Only the latest code on `main`, which is what taptotrade.ca runs.
