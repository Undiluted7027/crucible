# Crucible — First end-to-end POC slices

This is the implementation slicing plan for the [proof-of-concept proposal](poc.md). The proposal defines the product scope and acceptance requirements; this document organizes that work into demonstrable feature increments. The repository's `AGENTS.md` remains canonical.

**Status:** Proposed build plan. The completion criteria below are targets, not claims of implemented capabilities.

## Intended outcome

An engineer opens a finding, reproduces it in a disposable environment, compares two repairs, and hands someone else a replayable result. Agent assistance is part of that experience.

The ambition is to use AI-assisted development to complete more of the product, including difficult failure cases and a polished interface. A one-to-two-day target can guide execution, but it is a planning assumption, not a measured productivity claim or a delivery guarantee. Working acceptance checks determine what is complete.

All six slices belong in the intended first POC. Each slice ends with something demonstrable through the product. Build visual quality alongside functionality: clear progress, useful empty and failure states, readable evidence, and a comparison view that makes the decision understandable.

## Dockside integration

[Dockside](https://github.com/newsnowlabs/dockside) is the planned environment backend over Docker. Follow the [ownership and containment requirements in the POC](poc.md#docksides-role). Use its lifecycle operations, browser IDE, and service routing through one typed adapter. Crucible owns capsules, reset and lineage, agent permissions, evaluation, and evidence. Prove the integration in slice 1 and retain it through clean replay and the second case.

## Slice 1 — Open a capsule and reproduce a finding

**User outcome:** “I opened this finding and saw the actual violation, with evidence.”

Build the first path through the entire system:

- A capsule library with the curated invoice case and its source, prerequisites, and limitations.
- A workspace that starts an isolated target and shows preparation progress, readiness, and logs.
- A **Run checks** action backed by the trusted external evaluator.
- A persisted run showing the trigger, observations, functional controls, and scoped verdict.

Introduce only the contracts needed here: capsule, environment, experiment, run, and individual check observations. UI and CLI call the same operations.

Implement the Dockside adapter and pin the server/CLI version and Crucible profile. Verify application readiness separately from container status. Link the workspace to the candidate's Dockside IDE and access-controlled service routes. Use a restricted target profile without host Docker socket or credential injection; test cross-candidate and management-plane isolation and execution-time egress. Do not depend on the upstream roadmap's forthcoming firewall management.

Correct the invoice fixture's remaining user-supplied-template risk and establish known vulnerable and repaired revisions. Recheck the advisory and version boundaries against the publisher's advisory. Pin the materials needed to run the case.

**Done when:** The vulnerable revision reproduces the violation, the repaired revision passes its declared controls, and failed startup or malformed responses cannot appear as a successful repair. From the first execution, targets have resource limits, deadlines, declared network access, protected evaluator materials, and cleanup on success and failure. Use synthetic data and harmless markers without exposing host credentials or the Docker socket to targets.

## Slice 2 — Create independent repair experiments

**User outcome:** “I can try changes without losing my baseline or contaminating another experiment.”

Add candidate creation from the declared baseline, separate writable source and state, and the full environment lifecycle: create, start, stop, reset, and delete.

Make independence visible in the product. Use stateful invoice data so the engineer can change one candidate and see that the baseline and the other candidate remain unchanged. Reset restores the declared seed while preserving past runs.

Show candidate lineage, current source changes, and environment status in the workspace. Candidate creation reconstructs the declared baseline and seeded state; it does not imply a live-memory snapshot.

Map each environment to its Dockside instance. Drive lifecycle operations through the adapter and implement reset by reconstructing source and seed state. Verify that source/data mounts are independent and that deleting an instance cleans up Crucible-owned resources without touching unrelated Dockside environments.

**Done when:** Two candidates can run concurrently; source and data changes stay isolated; reset reliably restores the initial state; failure and deletion leave no target resources behind.

## Slice 3 — Compare repairs and make a decision

**User outcome:** “I understand which repair works, which breaks the feature, and why.”

Build the comparison experience around the baseline and two candidates:

- Patch differences alongside security and functional observations.
- Requests, relevant responses, and logs linked to each run.
- Clear identification of the exact source and state evaluated.
- A way to select the repair to carry forward.

Exercise three repair outcomes: an ineffective change, a feature-breaking change, and a successful scoped repair. Preserve individual observations when results are mixed. Use the verdict semantics in the POC proposal; never present a global safety verdict.

Link each candidate to its Dockside IDE and service URL for manual investigation. Tie evidence to the evaluated source revision even if someone later edits files through the IDE; historical results must not appear to evaluate those later edits.

**Done when:** Someone unfamiliar with the fixture can explain the finding and choose the supported repair using the comparison view. A reproduced violation remains visible even if another check is inconclusive.

## Slice 4 — Let an agent investigate and repair a candidate

**User outcome:** “I can ask an agent to try a repair, watch its work, and independently check the result.”

Integrate one real model adapter with bounded operations: inspect metadata, read candidate source and logs, edit candidate files, execute permitted candidate commands, request evaluation, and compare runs.

Show actions, patches, and linked evidence as an activity timeline. Include cancellation, execution deadlines, action budgets, and scoped network permissions. Preserve the candidate when the agent stops so a human can continue.

Treat repository text and target responses as untrusted input. Disclose what public fixture code and synthetic data the model service receives. The evaluator determines outcomes independently of the agent's explanation or candidate-generated tests.

Execute candidate operations through the controller's bounded tools against the assigned Dockside instance. Keep Dockside management sessions and credentials outside the agent and target. Running an unrestricted coding CLI in a Dockside IDE does not satisfy this slice's action history, permissions, or cancellation requirements.

**Done when:** An actual agent session produces an inspectable repair attempt and independent evaluation. It cannot write evaluator expectations or access host/controller credentials, and cancellation stops outstanding work. An unsuccessful repair is clearly explained and still leaves useful work behind.

## Slice 5 — Export an experiment and replay it elsewhere

**User outcome:** “Another engineer can verify this without reconstructing my setup.”

Export the capsule, required replay materials, selected patch, input identities, and evidence. Support import into a fresh workspace and replay through the CLI and GitHub Actions. Replay remains usable without the model service.

Provide a readable evidence report with the finding, changes, results, limitations, and replay instructions. Bound retained evidence and redact secrets. Artifact hashes identify materials; a clean replay separately establishes that the required materials are available and usable.

Include the pinned Dockside requirements, reviewed profile, and non-secret network/setup instructions in replay materials. Prove replay on a clean supported runner with a compatible Dockside installation. Exclude server sessions, user tokens, private keys, and machine-specific instance URLs from portable configuration.

**Done when:** A clean supported runner reproduces the declared outcomes without undocumented edits. Missing materials and unsupported platforms produce explicit failures.

## Slice 6 — Revalidate changes and prove reuse

**User outcome:** “The experiment stays useful as code changes, and this works beyond one demonstration.”

Add watched-input tracking and stale-evidence presentation. CI passes only current, supported checks. Reproduced violations and functionality regressions fail the security gate; unsupported, inconclusive, environment-failed, and stale outcomes explicitly require review. Stale evidence does not itself prove a new vulnerability.

Bring the second case through the same library, lifecycle, evaluation, comparison, and replay operations. Keep case-specific setup and checks in the capsule rather than adding fixture branches to the controller. Include npm audit JSON import and a manually authored finding without a CVE identifier, preserving unsupported findings and unrelated scanner warnings.

Use the same Dockside adapter for the second case. Watch the reviewed profile, runtime/image identity, and relevant network configuration alongside application inputs so changed environment assumptions invalidate earlier evidence.

**Done when:** Changing a watched assumption invalidates prior evidence, rerunning produces a fresh result, and the second case works through the same product. Characterize timing variability before accepting portable conclusions for the semver case.

## Completion and priorities

Slice 1 establishes the architecture; slices 2–4 make it a working investigation product; slices 5–6 substantiate the promise that experiments are transferable and reusable. Validate the integrated result against the full acceptance matrix in the [POC proposal](poc.md#12-acceptance-criteria-and-impact-measurement), including selected containment boundaries and cleanup after timeouts and errors.

Use focused tests for difficult behavior and business rules: invalid execution must not pass, mixed observations must retain violations, candidates must remain independent, resets must restore state, agents must remain bounded, and replay must detect changed assumptions. Avoid duplicating happy-path checks solely to increase coverage.

Measure cold preparation, warm environment creation, reset, evaluation, authoring effort, and handoff separately. Record the supported platform and hardware. Compare handoff effort with a prepared Docker/Compose setup and ordinary scripts, and rehearse the complete journey with an unfamiliar developer where possible.

Defer public hosting, team permissions, arbitrary-repository automation, additional model providers, and advanced snapshots. The first POC deliverable is a complete local workflow with two cases, real agent work, and demonstrated clean replay. Report incomplete capabilities explicitly.
