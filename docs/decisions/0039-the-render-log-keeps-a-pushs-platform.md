# 0039. The render log keeps a push's platform, and a template's Usage splits Push by it

Status: Accepted
Date: 2026-10-11

## Context

A push is rendered for one phone, which the request names (`platform`, `ios` or `android`): iPhone shows a subtitle
and Android never does, and the 4,096-byte limit is checked per phone ([0034](0034-message-channels-families-and-the-fields-registry.md)).
The `render_log` row kept only `channel: "push"`, so Usage couldn't tell iPhone pushes from Android ones, and a failed
push couldn't be traced to the phone it failed on. A template's own Usage tab also had no split by channel: only the
team Overview did ([handoff review N22 and N23](../handoff-review.md#n22--low-a-templates-usage-tab-has-no-per-channel-split)).

## Decision

- **`render_log` gets a nullable `platform`** (`ios` or `android`; migration 0013). `runRender` sets it from the
  render's target, so it is there for a push, a push preview and a failed push alike, and null for every other
  channel. `writeRenderLog` copies it by name like the other fields. It is a setting of the request, not a variable
  value, so the log's keys-only rule holds: no value, request body or output is stored.
- **Rows already written stay null.** They can't gain the phone later and nothing guesses it. A template's Usage
  counts them as "Push · not recorded" while there are any.
- **A template's Usage tab has "Renders by channel"** (last 30 days, one bar and its legend, as the Overview's
  channel mix): the channels its content type allows, each in its channel's hue ([0014](0014-chart-values-never-hover-only.md)).
  A document shows PDF, Web and Email; an alert shows Push and SMS, with Push split by phone. The same counts
  (`byChannel`, `pushByPlatform`) are read from the cells `getTemplateUsage` already groups by channel, with the
  platform added to the grouping.
- **The phones of a push share the push hue, the second one step fainter.** A hue means a channel on this page
  ([0014](0014-chart-values-never-hover-only.md)), and a phone is a member of a channel, so iPhone wears the push rose
  and Android the same rose at the fainter step the bars use for a week still in progress. The two tell apart by
  name rather than by colour: the legend prints each name with its share, and the sr-only table lists both. "Not
  recorded" is taupe, as the oldest versions are on the version chart.
- **"Recent failures" names the phone** after the channel ("Push · Android").

## Alternatives considered

- **A hue for each phone.** The five hues are the five channels', checked as a set. Another channel's hue for
  Android would read as that channel on the same page, and a sixth fails the set's colour-blind check.
- **The platform inside the error details or the correlation id.** Not a column, so Usage couldn't group by it.
- **Splitting the Overview's channel mix too.** Its card is the stat card's fixed size with all five channels in
  the legend; a sixth entry wraps it to a third line. The Overview keeps Push as one share; the template's tab,
  where a team looks at one alert, has the room.
- **Backfilling old rows.** The log holds no customer, so there is nothing to derive a phone from.

## Consequences

- The backend that keeps the log (the Java service, if it replaces this app's) needs the same nullable `platform`;
  it is part of what a render writes.
- The template Usage read reads one more statement: the content type's channels, to list the right parts.
- Pushes logged before migration 0013 show as "Push · not recorded" on a deployed database. A fresh seed has none.
