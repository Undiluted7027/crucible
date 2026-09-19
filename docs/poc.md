# Crucible — Reproducible Security Environments
## Proof-of-concept proposal — TLN Cybersecurity Challenge 2026

**Open a working security environment. Reproduce the vulnerability. Try a repair. Share the evidence.**

**Working name:** Crucible. “CVE Replay” names the first workflow within the product, rather than the limit of the product.

**Document status:** Proposed hackathon build, grounded in existing local experiments. This is a design and evaluation plan, not a claim that every capability is implemented.

**Primary challenge areas:** Security monitoring; AI-powered security; web and mobile tools. The replayable examples also support security education.

**Deliverable:** A working security experimentation workspace with disposable environments, vulnerability capsules, independent repair experiments, agent assistance, evidence comparison, portable export, and CI replay.

---

## 1. Executive summary

Crucible is a workspace where engineers and AI agents can investigate vulnerabilities inside reproducible, disposable application environments. It brings environment preparation, vulnerability reproduction, repair experiments, and evidence into one workflow.

Today, a finding often arrives as a warning, a report, or a collection of reproduction steps. An engineer still has to reconstruct the application, install the right dependencies, prepare its state, reproduce the behavior, and determine whether a repair works without breaking the feature. Another engineer or agent may repeat that setup to review the result.

The central artifact is a **security capsule**: a versioned package describing the application revision, environment, initial state, finding, trigger, checks, and required materials. A capsule can create multiple independent environments. A human or agent can change one, compare it with the baseline, reset it, and export the experiment for someone else to replay.

**The product promise:** “Open the finding in a working environment, investigate it, and give the next person an experiment they can rerun.”

CVE investigation is the first complete workflow. The same environment and experiment model should support application bugs, pentest findings, and agent-proposed repairs when their setup and security expectations are supplied. Those extensions do not require every finding to have a CVE identifier.

The hackathon will demonstrate an integrated product, with a curated CVE case as its first acceptance test. A second case will test whether the infrastructure is reusable. Support boundaries and unfinished capabilities will remain visible.

## 2. The three questions

### What problem are we solving?

Security findings are difficult to turn into working, transferable experiments. Developers spend time reconstructing environments and interpreting incomplete evidence. They need to understand whether a vulnerability affects their system, try repairs, and hand off results without losing the setup and assumptions behind them.

### Why does it matter?

Setup and investigation delay repairs. A patch can block one trigger while breaking legitimate behavior. Evidence can become outdated when dependencies, configuration, or application code change. Teams with limited security expertise need tools that make these decisions inspectable.

Recent public discussions describe manual CVE triage even after reachability filtering and disagreements over applicability [1–3]. These support the first use case; they do not by themselves establish demand for a general environment platform or a universal false-positive rate.

AI agents are part of both the build strategy and the intended workflow. This project assumes they let the team attempt more implementation within the event. That assumption is not a measured productivity claim. Giving an agent a prepared environment, bounded tools, and an independent evaluator also provides a concrete way to check its proposed repairs.

### Why is this approach appropriate?

Packaging the setup, state, trigger, and checks together makes a finding easier to reproduce and transfer. Independent environments allow competing repairs without contaminating the baseline. Functional controls expose repairs that disable required behavior. Preserved evidence explains exactly what was tested.

Source control, ordinary tests, and CI remain part of the workflow. The added value to establish is less setup and handoff work than a documented repository plus Docker/Compose and scripts. A successful demo must show that benefit through a clean replay and an understandable comparison.

## 3. Intended users and product experience

**Primary hackathon user:** A software engineer investigating a vulnerability or reviewing a security repair, often without a dedicated application-security specialist.

**Additional audience to validate:** AppSec teams exchanging reproducible findings and teams developing security agents that repeatedly need environments, resets, and evaluation. These audiences may have different purchasing needs; no single buyer is established yet.

**Initial supported stack:** Node/TypeScript on a declared Linux/container platform. Start from a supplied repository and reviewed setup recipe. Include one stateful fixture using a local database or controlled file store so that resets and independent instances are observable.

**User story:**

> As an engineer receiving a security finding, I want to open a working reproduction, test several repairs with an agent or by hand, and share the exact experiment so another person can verify my result.

### Core journey

1. Open or import a capsule; inspect its source revision, environment requirements, finding, and known limitations.
2. Create an environment and observe build progress, readiness, service status, and initial state.
3. Run the reproducer and inspect requests, effects, logs, and the named security expectation.
4. Create two independent experiments from the same declared baseline.
5. Apply a manual repair in one and let an agent propose or apply a bounded repair in the other.
6. Run the trusted security checks and legitimate-use controls against each instance. Compare changes and results.
7. Reset an experiment to the declared initial state and repeat the run.
8. Export the capsule, selected repair, and evidence. Replay on another supported machine or CI runner.
9. Revalidate when relevant code, configuration, dependencies, or assumptions change.

The prototype will label prepared capsules and manual authoring clearly. Importing an arbitrary repository is allowed to produce a setup proposal or an unsupported result; it must not pretend to produce a working environment automatically.

### Main interface

| View | What the engineer can do |
|---|---|
| Capsule library | Open a finding, inspect its prerequisites, import/export its materials |
| Environment workspace | Create, start, stop, reset, and delete instances; inspect readiness and logs |
| Experiment comparison | See baseline and candidate changes, state identities, checks, and outcomes together |
| Agent activity | Inspect requested actions, bounded tool execution, patches, and linked evidence |
| Evidence report | Review scoped conclusions, remaining unknowns, and replay instructions |

## 4. First acceptance scenario: CVE investigation

The main scenario uses an invoice-rendering fixture and a documented lodash advisory already explored in this workspace. The precise advisory and version boundaries must be rechecked against the publisher's advisory before presentation. Prefer a response-based check for the main stage demo; the existing semver timing experiment is a secondary engineering case.

| Stage | What the audience sees | What it establishes |
|---|---|---|
| Open environment | Start the capsule and inspect pinned inputs, service readiness, and synthetic initial state | The finding comes with a runnable setup |
| Warning | An imported dependency finding, its source, and the relevant application path | A concrete starting point from an existing workflow |
| Reproduction | A harmless marker demonstrates the named unwanted behavior in the disposable target | The specific behavior occurred under these conditions |
| Independent experiments | Create two instances; mutate state in one while the other remains unchanged | Repairs and state do not contaminate the baseline |
| Misleading repair | A candidate upgrade still permits the named trigger | A changed version alone is not this experiment's success criterion |
| Broken repair | The trigger is blocked, but a required invoice-rendering control fails | Preventing the trigger can also break the product |
| Successful scoped repair | The named trigger is blocked and declared functional controls pass | The repair passes these checks, without claiming whole-application safety |
| Reset and handoff | Restore initial state, export the selected experiment, and replay it in CI | Another runner can reproduce the declared results |
| Later change | A PR alters a declared input/configuration assumption; CI marks the evidence stale | Previous conclusions cannot silently outlive their assumptions |

For the last step, begin with an explicit, machine-checkable restriction: for example, the demo endpoint accepts only a fixed server-owned template. Record the relevant files and configuration in the capsule. Change that restriction in a separate revision. The first implementation may conservatively invalidate evidence whenever a watched file changes; semantic detection of every newly exposed path is outside scope.

**Important existing-fixture limitation:** The local review found that the dependency-fixed invoice application still accepts executable user-supplied templates. Before using it as the example of a guarded application, constrain templates and options at the application boundary and add legitimate-use controls for the intended behavior. Until then, present only the named advisory result and visibly record the remaining application risk [L2].

## 5. Hackathon scope

The target is a complete environment-and-experiment product. The CVE case proves the workflow; it does not define the maximum feature scope.

### Committed capability targets

| Area | Planned capability | Completion evidence |
|---|---|---|
| Environment lifecycle | Create, start, stop, reset, and delete disposable instances from a declared recipe | Readiness, failure handling, cleanup, and restored initial state are demonstrated |
| Capsules | Version source, setup, state, finding, trigger, expectations, and replay materials | An exported capsule runs on a clean supported runner |
| Independent experiments | Create separate instances from a common baseline; edit and compare repairs | Changes to source and mutable state in one instance do not alter another |
| Vulnerability investigation | Import npm audit JSON and support a manually authored finding without requiring a CVE ID | Supported checks run; unsupported findings remain visible |
| Repair evaluation | Run trusted security checks and legitimate-use controls against each candidate | Distinguish reproduced violations, scoped passes, broken functionality, and unresolved results |
| Agent assistance | Inspect source/logs, propose a patch, apply it to a candidate, and request a check | One actual bounded agent session produces an inspectable action trail and independently evaluated result |
| Product interface | Library, environment controls, experiment comparison, agent activity, evidence | The main workflow can be completed through the interface |
| Developer workflow | CLI, artifact export, GitHub Actions, and assumption invalidation | A capsule replays in CI and changed assumptions mark previous evidence stale |
| Reuse | Exercise the same lifecycle and reporting machinery with a second case | New case configuration is separate from the shared runner and evaluator protocol |

An agent's unsuccessful repair is a valid demonstration if the evaluator correctly rejects it and the interface explains why. The target is dependable experimentation, not a guaranteed autonomous fix.

### Extensions after the integrated workflow works

- Independently sourced application cases beyond the authored fixtures.
- Compose-style multi-service environments, databases, queues, and declared service substitutes.
- Assisted capsule authoring from a report, test, or repository setup.
- A shared capsule registry and review links; authenticated team access requires its own security evaluation.
- Draft repair PRs, additional scanner adapters, VEX export, and scheduled replay.
- Runtime instrumentation linking requests to selected application/dependency calls, with explicit coverage.
- Faster preparation and reset using image caches or snapshots where measurements justify them.

### Boundaries

The POC supports declared environments and reviewed checks. It does not promise universal repository setup, all CVEs, exact production cloning, automatic discovery of unknown vulnerabilities, or proof of whole-application security. Running the same request again is replay at the experiment level; exact deterministic process replay is a separate capability.

The initial “fork” operation creates an independent instance from a declared baseline and seeded state. It does not claim instant live-memory snapshots or copying every in-flight connection. Broader environment support can grow without obscuring that distinction.

## 6. Proposed architecture

```text
Web workspace / CLI / CI / bounded agent tools
                       |
                       v
       Capsule registry + experiment controller
       (recipes, revisions, state, run history)
                       |
                       v
           Environment lifecycle manager
              Dockside adapter
             /          |          \
            v           v           v
        Baseline    Candidate A   Candidate B
        isolated     isolated      isolated
        source + independent mutable state
             \          |          /
                       v
            Trusted external evaluator
       security checks + functional controls
                       |
                       v
        Evidence store + comparison reports
                       |
                       v
           Export / clean replay / CI
```

**Proposed implementation:** TypeScript/Node for orchestration and shared schemas, React for the workspace, Dockside as the initial environment backend over Docker, a metadata database plus an artifact directory for local persistence, and GitHub Actions for replay. These are design choices, not completed integrations.

### Dockside's role

Use [NewsNow Labs Dockside](https://github.com/newsnowlabs/dockside) for environment provisioning and access. Its documented CLI exposes create, inspect, start, stop, remove, and logs operations through the same HTTP API used by its web interface. Dockside also supplies browser IDEs, SSH access, and HTTPS service routing. Reuse those capabilities through a small typed adapter; link to the candidate's Dockside IDE from Crucible rather than building another editor. Dockside's devtainers are not the VS Code devcontainer specification.

Crucible owns capsule definitions, source and seed-state identity, experiment lineage, reset semantics, bounded agent actions, trusted evaluation, evidence, export, and stale-input detection. Store Dockside instance identifiers and access URLs alongside Crucible environment records. A running devtainer is not proof that the application is ready. Reset means reconstruction from the declared source and seed, not an assumed Dockside snapshot operation.

Slice 1 must prove this integration with a pinned Dockside server/CLI version and a reviewed Crucible profile. Verify lifecycle behavior, readiness, resource limits, network restrictions, and cleanup against the actual installation. Keep any missing capability explicit; do not silently replace Dockside or weaken the acceptance requirements to make the demo work. The upstream CLI is Python; using it as an external tool does not require rewriting Crucible's TypeScript controller.

Dockside is part of the trusted management plane. Its server needs Docker management access, which must never be passed into vulnerable targets or agent tools. The upstream security guide warns that the default Dockside development profile mounts the host Docker socket and that services can be reachable between devtainers by default. Create a dedicated restricted profile, prevent credential/key injection into targets, and verify isolation between candidates and from management services. Keep IDE/service routes access-controlled. The README currently describes built-in outbound firewall management as forthcoming, so enforce and test execution-time egress restrictions through the selected host/network setup.

Export the versioned profile and required non-secret setup with the capsule's replay materials. Clean replay must provision or connect to a documented compatible Dockside installation and reproduce the same restrictions. Never export management sessions, user tokens, or private keys. Both POC cases must use the same adapter.

Sources reviewed on September 19, 2026 at upstream revision `c5834215605e4230f9c1f6b576fd8f49b5a71629`: [overview](https://github.com/newsnowlabs/dockside/blob/c5834215605e4230f9c1f6b576fd8f49b5a71629/README.md), [CLI](https://github.com/newsnowlabs/dockside/blob/c5834215605e4230f9c1f6b576fd8f49b5a71629/cli/README.md), and [security guidance](https://github.com/newsnowlabs/dockside/blob/c5834215605e4230f9c1f6b576fd8f49b5a71629/docs/securing.md). These establish the integration plan, not completed Crucible compatibility or containment tests.

The controller owns lifecycle and permissions. A manifest identifies the environment recipe and explicitly declared build/start/readiness/reset actions. The lifecycle manager executes supported operations, reports status, and cleans up resources. It must not silently ignore manifest fields or hardcode one fixture's setup.

Each experiment receives separate writable source and data volumes and a declared network scope. Candidate changes are recorded as revisions or patches. The evaluator and expectations remain outside target and agent write access. Results include environment identity, individual observations, and scoped conclusions.

The web interface, CLI, agent, and CI consume the same operation and report contracts. This makes additional interfaces possible without duplicating grading logic. The initial local workspace needs no public multi-user hosting.

### Product objects and lifecycle

- **Capsule:** The versioned recipe and security experiment definition.
- **Environment:** A concrete instance with source, services, configuration, and mutable state.
- **Experiment:** A baseline or candidate revision plus the actions performed against it.
- **Run:** One evaluation against identified inputs, with an immutable evidence record.

Environment states are `created`, `preparing`, `ready`, `running`, `stopped`, `failed`, and `deleted`. Reset reconstructs the declared initial state; it preserves earlier evidence in the controller's store. Security verdicts are independent of these lifecycle states.

### Capsule contents

| Field | Purpose |
|---|---|
| Finding ID and references | Identify a CVE, GHSA, pentest report, or manually supplied security claim |
| Source revision and dependency lockfile | Identify application code and resolved packages |
| Runtime/image identity and platform | Declare the environment used |
| Setup and readiness checks | Distinguish a running application from a broken environment |
| Initial state and reset recipe | Supply synthetic fixtures and any required test identities; restore mutable state |
| Service topology and isolation requirements | Declare services, volumes, permitted communication, and resource limits |
| Baseline and candidate lineage | Identify which environment and patch each experiment uses |
| Security property and trigger | State the expected boundary and exercise the named behavior |
| Functional controls | Verify required legitimate behavior still works |
| Assumptions and watched inputs | Define when evidence must be revalidated |
| Checker version and deadlines | Identify the evaluator and bound execution |
| Observations and artifacts | Preserve requests, relevant responses, logs, and outcomes |

Record artifact hashes for identity. Hashes alone do not guarantee future availability or reproducibility; the clean-runner handoff is a separate acceptance test.

## 7. Evidence and verdict rules

The interface must use scoped language:

| Result | Meaning |
|---|---|
| **Violation reproduced** | The checker observed the named security violation in this run. |
| **Declared checks passed** | The named trigger was blocked and the declared legitimate-use controls passed. |
| **Functionality regression** | A declared required behavior failed in a recognized way. |
| **Inconclusive** | Observations were insufficient or did not match a reviewed expectation. |
| **Environment failed** | Setup or readiness failed, preventing a valid experiment. |
| **Unsupported** | No reviewed capsule exists for the finding. |

**Evidence stale** is a separate lifecycle flag. It means inputs or assumptions changed after the recorded run; it is not proof of a newly exploitable vulnerability.

Keep individual observations visible. A reproduced violation must not disappear because another control is inconclusive. Static reachability, a missing direct import, and a failed reproduction attempt cannot independently justify “not affected.” The prototype must not display a global “SAFE” verdict.

Before trusting a check, demonstrate that it distinguishes the known vulnerable and repaired fixtures. Keep the checker and expected outcomes outside the candidate patch's control. Include malformed-response and failed-startup cases so that broken execution cannot appear as successful remediation.

### CI behavior

- Fail the demo security gate on a reproduced violation or a functionality regression.
- Report unsupported, inconclusive, environment-failed, and stale states explicitly; require review rather than silently passing them as resolved.
- Pass only the declared supported checks with current evidence.
- Preserve the original scanner findings. The prototype does not automatically suppress unrelated warnings.

## 8. Security and privacy of the tool

The runner executes intentionally vulnerable software, so containment is a prerequisite for the end-to-end demo.

- Run only owned fixtures or explicitly authorized targets.
- Use disposable target containers with resource limits and execution deadlines.
- Do not mount host credentials, the Docker socket, or writable checker files into the target.
- Separate dependency preparation from test execution; restrict execution-time network access to declared peers.
- Use synthetic data and harmless markers instead of real customer records or destructive effects.
- Retain bounded, relevant evidence with secrets redacted.
- Terminate and clean up all target resources after each run, including failure paths.

These controls must be tested on selected boundaries. They are not a claim that containers make arbitrary hostile workloads risk-free.

## 9. Agent-assisted investigation and repair

Agent assistance is a planned product capability. An engineer can ask an agent to inspect a finding, explain observed behavior, propose a repair, and run experiments in a candidate environment. Humans retain the same lifecycle and testing tools.

The first agent adapter exposes a bounded set of operations: inspect capsule metadata, read candidate source, read logs, edit candidate files, execute permitted commands inside that candidate, request evaluation, and compare results. Every action is associated with an experiment and retained in its activity history. The agent receives no host shell, controller credentials, or writable evaluator access.

Use action budgets, execution deadlines, cancellation, and scoped network permissions. Treat repository text and target responses as untrusted inputs that cannot expand tool permissions. Independent checks determine the recorded outcome; an agent's explanation cannot override it. If the agent fails or exhausts its budget, preserve its work and let the engineer continue manually.

The assistant must distinguish observed facts from proposed explanations and reference the relevant evidence. It must not invent execution results, change the expectations to make a patch pass, or convert uncertainty into a safety claim. Candidate-generated tests can supplement investigation, but cannot silently replace the trusted acceptance checks.

For the hackathon, use public fixture code and synthetic data and disclose what the model service receives. Keep the runner, evaluator, export, and replay usable without the model service so a saved experiment remains independently reproducible.

## 10. Existing foundation and remaining work

The workspace already contains a static-analysis experiment and two dynamic advisory capsules. The September 19 review records seven revision outcomes matching their expected results, including two feature-breaking repairs. Those are previously recorded local results; this document does not report a new execution [L1–L2].

| Existing evidence | Work required for this proposal |
|---|---|
| Two capsules share runner/checker infrastructure | Add actual target isolation and protect evaluator materials |
| Vulnerable and repaired revisions have been compared locally | Replace broad verdicts with scoped results and retain full evidence |
| Functional controls catch feature-breaking patches | Correct the invoice fixture's remaining template-input risk |
| A static analyzer supplies candidate paths | Present analysis limitations and preserve unresolved findings |
| A second, timing-based case exercises the harness | Characterize timing variability before claiming portable results |
| Manifests describe parts of the experiment | Pin complete inputs and prove clean-runner reproduction |
| Console output demonstrates local behavior | Build the workspace, comparison view, CI integration, and stale-evidence workflow |
| Local fixtures provide known starting conditions | Implement explicit lifecycle operations, state reset, and independent candidate instances |
| Patches can be compared through the current harness | Add bounded agent operations and retain experiment/action history |

The existing processes share host access; temporary directories are not an isolation boundary. The review also documents missing deadlines, incomplete evidence retention, and static-analysis blind spots. Those findings take precedence over stronger language in older experiment READMEs [L2].

This POC implements the environment-and-experiment direction in the [product brief](PRODUCT-BRIEF.md). The hackathon centers the developer experience, with CVEs as the first demonstration and agent workflows included in the product. Other customer segments remain hypotheses to validate separately.

## 11. Build sequence with agent-assisted implementation

The [first end-to-end POC slice plan](poc-slices.md) translates this proposal into six demonstrable feature increments, with user outcomes, scope, and completion criteria. All six slices are intended for the first POC; the plan preserves this proposal's acceptance requirements and distinguishes delivery ambition from verified completion.

Plan for a broader implementation using coding agents, while accepting capabilities only after integrated checks. The event duration and team size are not specified; this is a dependency-ordered plan rather than a promised calendar schedule.

1. **Define shared contracts and a working vertical slice.** Specify capsule, environment, experiment, run, and evidence schemas. Correct verdict semantics and the main fixture. Prove the Dockside adapter and restricted profile, start an isolated target, and record one trustworthy evaluation.
2. **Expand environment operations.** Implement lifecycle state, logs, per-instance volumes, seeded data, reset, independent candidates, deadlines, and cleanup. Exercise these with a stateful fixture.
3. **Build the workspace and comparison experience.** Implement the library, environment controls, candidate diffs, check results, evidence, and failure states against the shared contracts.
4. **Connect the investigation agent.** Expose bounded operations, action history, cancellation, and evaluation requests. Run a real agent-driven candidate experiment and verify evaluator separation.
5. **Make experiments portable and persistent.** Package required materials, export/import, replay in CI, and invalidate evidence on changed inputs or assumptions.
6. **Prove reuse and rehearse.** Add the second case through the same interfaces, run the acceptance matrix on a clean runner, measure timings, and rehearse the complete journey.

Environment operations, UI, agent integration, and CI/export are separable implementation workstreams once their shared contracts exist. Coding agents can accelerate work within them; end-to-end integration is a dedicated milestone, not an assumption that independently generated pieces will fit.

Prioritize complete user journeys over additional settings or integrations. If time is constrained, defer public hosting, broad stack coverage, advanced snapshots, and extra adapters first. Preserve the core environment lifecycle, independent experiments, trusted checks, evidence, agent demonstration, and clean replay. Report any incomplete target honestly rather than substituting a mock execution.

## 12. Acceptance criteria and impact measurement

All rows below are **targets to verify**, not results already achieved by this document.

| Test | Passing evidence |
|---|---|
| Environment lifecycle | Create, start, stop, and delete succeed; readiness and errors are visible |
| State reset | Mutated files/database fixtures return to their declared initial values; prior evidence remains available |
| Independent candidates | Source and state mutations in A do not change B or the baseline |
| Agent session | Actual bounded actions, a proposed patch, and independent evaluation are visible in history |
| Agent containment | Agent cannot edit trusted expectations or access host/controller credentials; cancellation stops its outstanding work |
| Second case | Same lifecycle and report contracts work with another case without fixture-specific runner branches |
| Vulnerable application | Named violation is reproduced and the trigger is visible |
| Ineffective candidate repair | Still reports the observed violation |
| Feature-breaking repair | Reports the failed legitimate-use control |
| Correct scoped repair | Named trigger is blocked; all declared controls pass |
| Missing or failed environment | Reports failure or inconclusive status, never success |
| Changed assumption | Prior evidence becomes stale and CI requests revalidation |
| Unsupported finding | Remains visible and unresolved |
| Checker integrity | Target cannot modify checker files or expected outcomes |
| Selected containment boundaries | Target cannot read a planted host-secret fixture or contact an undeclared destination |
| Cleanup | No target containers/processes remain after success, timeout, or error |
| Handoff | Another supported clean machine or CI runner reproduces declared outcomes without undocumented edits |

Measure setup time, time to first useful result, warm rerun time, manual steps, and repeated-run consistency. Record hardware and environment with measurements. If possible, ask an unfamiliar developer to explain the finding and evaluate a repair using the evidence view; record where assistance was needed.

Measure capsule-authoring effort and handoff time against a prepared Docker/Compose setup with ordinary scripts. Distinguish cold preparation, warm environment creation, reset, and evaluation durations rather than reporting a single speed number.

The immediate impact claim is measurable: **the prototype lets a developer or agent open a supported security environment, reproduce a finding, compare repairs, and transfer a replayable experiment with inspectable evidence.** Claims about hours saved, reduced breaches, or accuracy across arbitrary repositories require separate evaluation.

## 13. Five-minute presentation

| Time | Presentation beat |
|---|---|
| 0:00–0:40 | Explain the reproduction/setup problem. Open a capsule and show its environment and readiness. |
| 0:40–1:20 | Run the vulnerability trigger; inspect the actual evidence and required legitimate behavior. |
| 1:20–2:20 | Create two independent candidates. Show a bounded agent investigation and a feature-breaking repair being rejected. |
| 2:20–3:10 | Compare a successful scoped repair with the baseline; inspect the patch and declared checks. |
| 3:10–4:10 | Reset state, show instance independence, and demonstrate exported replay on the prepared clean CI runner. |
| 4:10–5:00 | Change a watched assumption, show stale evidence, disclose scope, and close on the transferable experiment. |

If runs exceed stage time, prepare environments in advance and label that preparation. Any prerecorded execution must be identified as recorded, with its revision and timestamp visible.

**Closing pitch:**

> Crucible gives engineers and AI agents working environments for security investigations. Open a finding, reproduce it, try repairs in independent instances, and share an experiment that someone else can rerun. CVE investigation is our first complete workflow.

## 14. Differentiation and path beyond the hackathon

Reachability analysis, automated remediation, executable vulnerability checks, and regression testing already exist. Earlier research identified Semgrep, Endor Labs, Pixee, Nuclei, and Escape as relevant alternatives [4–8]. This prototype does not claim to invent those capabilities.

Its proposed contribution is an integrated workflow: **finding → prepared environment → independent experiments → verified outcomes within scope → portable evidence → ongoing revalidation.** Existing environment recipes and security testing tools are substantive alternatives. The hackathon must demonstrate that bringing lifecycle, agent actions, and comparison into one workspace makes the handoff easier. The interface and capsule format alone are not a defensible advantage.

Beyond the event, evaluate software teams investigating findings and security-agent teams operating repeated experiments as separate customer groups. Measure environment-authoring effort, reliability, reset costs, review time, and clean handoff. Potential paid capabilities include maintained private environments, hosted execution, shared evidence, and evaluation infrastructure. A maintained capsule library and reliable framework adapters could support a product; expensive bespoke setup for every case could instead make it a services business. Customer demand and willingness to pay remain unvalidated.

## 15. References and evidence

Public sources below were consulted in the preceding research conversation. Community posts are anecdotal; vendor pages describe advertised capabilities and are not independent benchmarks.

1. [Developer discussion: CVE scanners generating more work than actual security](https://www.reddit.com/r/devops/comments/1nv7pt8/cve_scanners_generating_more_work_than_actual/), October 2025.
2. [Developer discussion: vulnerability debt and prioritization after filtering](https://www.reddit.com/r/devsecops/comments/1sy6jhc/vulnerability_debt_and_poor_vm_how_to_improve/), April 2026.
3. [Developer discussion: documenting vulnerability applicability with VEX](https://www.reddit.com/r/devops/comments/1sfvi9v/to_vex_or_not_to_vex/), April 2026.
4. [Semgrep Supply Chain](https://semgrep.dev/products/semgrep-supply-chain/).
5. [Endor Labs platform](https://www.endorlabs.com/platform).
6. [Pixee documentation](https://docs.pixee.ai/).
7. [ProjectDiscovery open-source tools](https://projectdiscovery.io/open-source).
8. [Escape: security regression workflow](https://escape.tech/solutions/industry/healthcare).

**Local project evidence**

- **L1:** [Capsule experiment and recorded setup](experiments/reachable-audit/capsule/README.md). Read with the corrections in L2.
- **L2:** [September 19 technical review](experiments/reachable-audit/REVIEW-2026-09-19.md). Source for recorded outcomes and known limitations.
- **L3:** [Broader product brief](PRODUCT-BRIEF.md). Context for portable security experiments and future evaluation.
