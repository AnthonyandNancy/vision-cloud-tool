# Contributing to DSH Vision Toolkit

Focused fixes, tests, DSH integration improvements, and documentation changes are welcome. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

1. Read [README.md](README.md).
2. Search existing issues and pull requests before opening duplicate work.
3. Open an issue before changing the tool schema, the output contract, or the model-resolution flow.
4. Keep each change narrowly scoped. Do not mix a feature or fix with unrelated refactoring or generated-output churn.

## Architecture and scope

DSH Vision Toolkit is an out-of-tree DeepSeek Harness Profile Bundle. Contributions must preserve these responsibilities:

- `vision_cloud_tool` is the only model-facing tool; it reads images through the DSH app's configured model via `ctx.llm.stream`.
- The output contract follows modlens v2 (`summary` / `ocr` / `layout` / `semantics` / `visual` / `uncertainty`); do not add pixel bounding boxes or numeric confidence.
- The tool is registered only when a model is selected in Settings; the default is off.
- The plugin holds no credential and no base URL — the DSH provider registry owns those.
- Model-visible output stays text and JSON; image bytes and authorization headers never enter logs or results.
- Inputs stay fenced to the session workspace or explicit `allowedDirs`, including realpath checks.
- The paste-to-path bridge remains Python-free and environment-free.

## Development setup

The release checkout is installable as-is because `lib/` is committed. Full source development uses the published DSH `0.1.0-rc.6` packages:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
```

Never commit credentials, `.env` values, or machine-local dependency paths.

## Required verification

Every pull request runs the dependency-free package gate:

```sh
pnpm run verify:portable
git diff --check
```

And the type/tests gates:

```sh
pnpm run build
pnpm test
pnpm pack --dry-run
```

## Documentation

- Keep `README.md` and `README.zh.md` synchronized in section order, commands, links, images, and claims.
- Refresh `assets/hero.png` and `assets/social-preview.png` only when the public positioning changes.
- Update `CHANGELOG.md` under **Unreleased** for notable user-facing changes.

## Pull requests

A pull request should contain:

- the concrete problem or use case;
- the chosen implementation and why it fits the existing ownership split;
- the exact verification commands and results;
- screenshots or tool transcripts when they prove Web behavior;
- documentation updates for every changed user-facing path.
