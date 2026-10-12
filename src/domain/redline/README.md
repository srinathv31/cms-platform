# `src/domain/redline`: what changed between two versions

The redline: what changed between two versions of a document, as one document a renderer can walk like the original
(contract: `RedlineDoc` in [review-types.ts](../review-types.ts)). A pure walk over the editor's TipTap JSON
([docs/render-spec.md](../../../docs/render-spec.md) §2): no TipTap runtime, so it ports as is. The review screen and
Compare paint it ([components/redline/](../../components/redline/index.ts)). A version's name and channel fields are
redlined here too: for an alert the fields are the whole content.

One file per stage of the diff, split by concern ([decision 0043](../../../docs/decisions/0043-split-files-by-concern-not-by-line-count.md)).
There is no barrel: import each export from the file that defines it. They follow the [domain
rules](../README.md#rules).

## Files

In reading order: the entry points, then the engine from the bottom up, in the order a diff uses it.

| File                                   | Holds                                                                                                                                      | Exports                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [document.ts](document.ts)             | The entry: the redline of a document against its base, the "Changes only" views, and a rename.                                             | `diffDocuments`, `changesOnly`, `groupUnchanged`, `nameChange`                     |
| [channel-fields.ts](channel-fields.ts) | A version's channel fields, redlined one at a time with the same engine, and their footer.                                                 | `diffChannelFields`, `addCounts`                                                   |
| [context.ts](context.ts)               | What the diff carries between steps: the per-call caches (content keys, word bags) and what a node diff returns.                           | `createCx`, `Cx`, `Diffed`                                                         |
| [nodes.ts](nodes.ts)                   | Reading and marking TipTap nodes: the keys that decide whether two nodes are the same, and the marks that show a node inserted or deleted. | `nodeKey`, `contentKey`, `kindKey`, `topLevel`, `uniqueIds`, `markAll`, `withMark` |
| [similarity.ts](similarity.ts)         | How alike two blocks are: the word overlap that pairs a block with its edited self when ids can't.                                         | `textSimilarity`, `rowSimilarity`                                                  |
| [align.ts](align.ts)                   | How blocks line up: by id, then by content and similarity, then the longest run that keeps its order.                                      | `align`, `TOP_LEVEL`, `LIST_ITEMS`, `INNER_BLOCKS`, `TABLE_ROWS`                   |
| [block-diff.ts](block-diff.ts)         | How a paired block differs: its children line up and are diffed recursively, or a changed kind is marked whole.                            | `diffNode`                                                                         |
| [inline-diff.ts](inline-diff.ts)       | How a textblock differs: a word diff of its inline content.                                                                                | `diffTextblock`                                                                    |

Tests sit beside each stage and call the entry points (`diffDocuments`, `diffChannelFields`), the way the review screen does.
[fixtures.ts](fixtures.ts) holds the builders for TipTap documents and the readers that check a redline is faithful.
[align.test.ts](align.test.ts) covers whole blocks; [block-diff.test.ts](block-diff.test.ts) nested ones;
[inline-diff.test.ts](inline-diff.test.ts) a paragraph's words.

## How blocks line up

Top level, and the same way inside lists, list items, callouts and cells:

1. By `attrs.id`. Drafts keep block ids across versions, so this is the normal case.
2. Where an id can't speak (missing, duplicated, or on one side only, and at least one of the two blocks has no id):
   identical content that occurs once on each side, then, between the pairs that keep their order, the most similar
   block of the same type (word overlap of 0.5 or more). Inside a list item, a callout or a cell, a stretch with as
   many blocks on each side pairs in order instead. Two blocks that both have ids, different ones, never pair: one
   was removed, the other added.
3. The longest run of pairs that keeps the base order (the LCS of the id sequences) stays put. At the top level every
   other pair is "moved"; inside a block it's a delete plus an insert.
4. Unpaired base blocks are "removed" and sit where they used to be; unpaired new ones "added".

## Rules

- **No base** (a first version, nothing to compare with): every block is "unchanged" and the counts are zero. The UI
  knows the base is null and says there is nothing to compare with yet.
- **A moved block whose content changed too is "changed",** with `movedFrom`. Counts tally statuses, so it counts once
  (the counts always add up to `changesOnly(doc).length`).
- **Trailing empty paragraphs** (the editor's trailing line) are left out on both sides, as the renderer does, so
  that line coming and going is never a change.
- **Unchanged nodes are the input objects, not copies.** Nothing here mutates its input.
- **Which version a review compares with** is decided in [lifecycle/baselines.ts](../lifecycle/baselines.ts), not here
  ([decision 0031](../../../docs/decisions/0031-a-correction-is-redlined-against-the-revoked-version.md)).
