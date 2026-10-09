# 0022. A variable keeps its identity across renames

Status: Accepted
Date: 2026-10-09

## Context

The variables panel told a renamed key from a removal plus an addition, but only from a map the editor kept in
memory (`{ newKey: keyAtLoad }`). Nothing saved it. A reload lost it, and submit, the submit dialog, the review
screen, consumer notices and the `/api/v1` `since` diffs compared variable lists by key alone, so a renamed key
reached consumers as a breaking removal plus a new variable, not as a rename they could map
([handoff review D8](../handoff-review.md#d8--medium-variable-renames-are-lost-between-the-panel-and-submit)).
`ContractChange` was one type with optional fields, so its readers needed `?? change.key` fallbacks.

A draft has to remember what each variable was in its baseline (`contractBaseline`: the Active version, else the
newest that still renders, [decision 0009](0009-correct-a-revoked-version-from-its-content.md)) across reloads,
change requests and "Revert to vN", including a draft corrected from a Revoked version, whose baseline is an older
version than the one it was copied from. The `/api/v1` diff compares any two released versions, not only
neighbours.

## Decision

- **A variable has an optional `id`.** Its identity is its id, or its key when it has none (`identityOf`).
- **The editor's variable store sets it.** A variable the editor creates gets a fresh UUID, which is never a valid
  key. A variable without an id (a starter's, an import's, the seed's, any list saved before this) gets the key it
  had when its key is first renamed: that was its identity all along, so the identity never changes. Renamed back
  to that key, it needs no id and drops it. A patch never changes an id.
- **The id is saved and copied with the variable list.** Autosave accepts it (1 to 64 of `A–Z a–z 0–9 _ -`) and
  refuses a list in which two variables share an identity. Every new draft, a change request's draft and a revert
  copy the list, ids included. It is never shown, and consumers never see it: `ApiVariable` lists key, label, type,
  required and example.
- **`diffVariables(baseline, current)` pairs in two passes.** A variable with an id pairs with the baseline
  variable of that identity, then every variable still unpaired pairs by key. So `a` → `b` → `c` is one rename
  `a` → `c`; renamed back is no change; a new variable on a renamed variable's old key is an addition beside the
  rename (the matcher bug in D11); a variable deleted and made again under its key is the same variable to
  consumers; a rename and a type change on one variable are both reported.
- **`ContractChange` and `ApiContractChange` are unions, one member per kind**, each with exactly its fields:
  `key_renamed`, `type_changed` and `label_changed` carry `from` and `to`, `added` and `removed` carry `type` and
  `required`. The JSON on the wire is the same as before; `key_renamed` is now actually sent.

## Alternatives considered

- **Save the panel's rename map with the draft.** A map is relative to one version, the one the draft was copied
  from. Submit against an older baseline (a correction of a Revoked version), a change request's new draft, "Revert
  to vN" and the API's diff between any two released versions would each have to rebase or compose maps along the
  version chain, and every place that copies a variable list would have to copy the map beside it. An id inside the
  list travels with it for free.
- **A fresh id on every variable, backfilled.** Just as correct, but it needs a migration rewriting every version's
  variables JSON, ids in the seed, the starters and import, and ids in hundreds of test fixtures. Using the key as
  the id of a variable that never had one gives the same identities with none of that.

## Consequences

- No migration. Lists without ids diff by key, exactly as before, until a key is renamed.
- A renamed variable's id can look like a key (`first_name` on a variable now keyed `given_name`). It is the
  variable's first key, not a reference to a current one.
- Contract changes frozen before this change stay as they were stored: a rename submitted earlier still reads as a
  removal plus an addition in its own version.
- A Java port keeps `id` as a nullable string in the variable JSON and the two-pass pairing in `diffVariables`.
- Coral, the simulated consumer, lists a rename as one Renamed change. It doesn't yet carry its field mapping from
  the old key to the new one when it relinks.
