# Crucible - Reproducible Security Environments

The idea is to make a workspace where engineers and AI agents can investigate vulnerabilities inside reproducible, disposable application environments. It brings environment preparation, vulnerability reproduction, repair experiments, and evidence into one workflow.

## Important

Your code must be such that it is readable, reviewable and can be maintained by other devs in the future. If the product itself is working but I can't explain how or even I can't understand what you did, that implementation and work will be moot. Always focus on implementability, maintainability, and simplicity.

I would rather see six tests that specifically cover the difficult cases and business logic than forty tests that only repeat happy-path checks and are coverage maxxers.

## Coding preferences - general

- Keep things simple. Channel "yagni" energy unless told otherwise.
- Typesafety is useful, take advantage of it.
- Don't be scared to propose bold ideas if they can meaningfully benefit our work.
- Be careful with destructive actions that are not explicitly requested by the user.
- Tests are good! Endless smoke tests, "regression tests" for feature deletions, etc, much less good. Tests should be focused, not slop.
- Comments are a great way to clarify functionality and how code is used. Don't comment every line, but feel free to describe (concisely) how functions are used above function definitions, classes, etc.
- Keep comments up to date! When making changes, it's important to keep things in sync.

## Coding preferences (Typescript focused - TS 6)

- It is ok if you need to change config files. But do not go on making those config related changes. You propose first. The changes can be as bold as you like but only if they meaningfully benefit our work.
- `any` is the enemy. Inferred types are our friend. Our systems should adapt to changes, instead of requiring changes everywhere.
- If your TS code looks like a Python dev wrote it, it is bad TS code.
- Avoid one-line functions that are just casting wrappers.
- Write TypeScript in ways that Matt Pocock and Theo Browne would be proud of.

## Coding preferences (Python focused - 3.13)

- Ruff and mypy are nice. Use them.
- Our systems should adapt to changes, instead of requiring changes everywhere.
- Write Python in a way such that the code is readable, maintainable.


## Build Preferences

- Always build in terms of features. Never rely solely on backend, frontend, db, etc.
- Build in increments or slices.
- Test driven development is nice.


## Additional
- We don't shy away from Python but we try to avoid it because it's typing system is not that great.


## POC implementation guidance

The project description and coding preferences above are canonical. Do not reinterpret, replace, or weaken them based on this section or on the POC specification. When guidance conflicts, follow the instructions above and ask Sanchit only when the conflict cannot be resolved safely.

Read both documents before planning or implementing POC work:

- [`docs/poc.md`](docs/poc.md) defines the product scope, architecture, boundaries, and acceptance requirements.
- [`docs/poc-slices.md`](docs/poc-slices.md) organizes the first end-to-end POC into six feature slices, with user outcomes, scope, and completion criteria.

Use the slice plan to sequence implementation while preserving the POC specification's requirements and the canonical guidance above. Both documents describe planned capabilities; verify implementation and acceptance evidence before treating a capability as complete.

Dockside is the planned initial environment backend over Docker. Read the [Dockside integration guidance](docs/poc.md#docksides-role) before environment work. Reuse its lifecycle and IDE access through a typed adapter; Crucible owns experiment semantics and trusted evaluation. Verify a restricted profile and network boundaries before running vulnerable targets. Dockside's default development profile is not the POC target profile.
