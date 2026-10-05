# Decisions log (Phases 5–7)

Autonomous calls made while finishing Phases 5–7. Each can be overruled at review. The per-track logs are merged in below at integration.

## Repository
- **Third-party reference screenshots removed from the repo** (2026-10-05). `reference-images/` held screenshots of another product (the Usage dashboard and settings-modal targets). They were removed in a normal commit on `prototype` before the repo was published publicly, and `/reference-images/` is now gitignored; the files remain on the local machine as design targets for QA. History was not rewritten, so commits before the removal (and the track branches cut from them) still contain them.
