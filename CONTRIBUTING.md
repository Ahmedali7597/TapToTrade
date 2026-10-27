# Contributing to Tap to Trade

Thanks for helping out. Bug reports, ideas and small pull requests are all welcome.

## Before you start

- Search the open issues first. For anything bigger than a small fix, open an issue so we can agree on the approach before you write code.
- Follow [Getting started](README.md#getting-started) to run the site locally.

## Branches and commits

- Branch from `main` with a short, descriptive name, like `fix/trade-keyboard` or `docs/readme-setup`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`. For example: `fix(trades): Send stays visible above a phone keyboard`. Types used here are `feat`, `fix`, `docs`, `test`, `refactor`, `chore` and `ci`.

## Pull requests

- Keep each pull request to one change, and link the issue it closes.
- Run `npm test` and `npm run build` before opening it. If you changed the API or the database, run `npm run test:api` too.
- Add or update tests for any behaviour you change.
- Database changes go in a new numbered file in `server/migrations/`, with a matching rollback in `server/migrations/down/`. Never edit a migration that has already run.
- Never commit `.env` files, API keys or other secrets.

## Reporting security issues

Please don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
