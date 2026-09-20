# Crucible replay evidence

Run: 1a02c884-ae6b-4cb6-b687-c3dd299b572d  
Recorded: 2026-09-20T13:44:00.247Z

Advisory: GHSA-r5fr-rjxr-66jc

Curated invoice fixture, not the scanned repository. Application-level mitigation on lodash 4.17.20; unrelated audit findings remain unresolved.

| Revision | Observed result | Target removed |
| --- | --- | --- |
| vulnerable | VIOLATION_REPRODUCED | Yes |
| broken | FUNCTIONALITY_REGRESSION | Yes |
| fixed | DECLARED_CHECKS_PASSED | Yes |

## vulnerable

| Check | Outcome | HTTP | Response |
| --- | --- | --- | --- |
| imports-code-injection | reproduced | 500 | CRUCIBLE_EXECUTION_PROOF |
| standard-invoice | passed | 200 | Total: $42 |
| custom-currency | passed | 200 | Total: €42 |
| server-owned-template | passed | 400 | Client templates are not supported |

## broken

| Check | Outcome | HTTP | Response |
| --- | --- | --- | --- |
| imports-code-injection | blocked | 200 | Total: $42 |
| standard-invoice | passed | 200 | Total: $42 |
| custom-currency | regression | 200 | Total: $42 |
| server-owned-template | passed | 400 | Client templates are not supported |

## fixed

| Check | Outcome | HTTP | Response |
| --- | --- | --- | --- |
| imports-code-injection | blocked | 500 | Unsupported imports option |
| standard-invoice | passed | 200 | Total: $42 |
| custom-currency | passed | 200 | Total: €42 |
| server-owned-template | passed | 400 | Client templates are not supported |

Environment: Dockside · sha256:cc62c7cee8a42e9abd23f77db795b15c3f726f5f7dbb2fcdeb42239c7c41e190

This report describes a past execution. Use `crucible verify <evidence.json>` to check for changed watched inputs. Verification is not a new execution, a tamper-proof attestation, or a check of the current Docker environment.
