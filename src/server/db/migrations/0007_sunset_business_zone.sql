-- A sunset date ends at 00:00 on that day in the business time zone (decision 0017): America/New_York
-- until a Platform Admin picks another, and no `business_zone` settings row means the default. Before,
-- a sunset was stored at its day's midnight UTC, which is 7 or 8 PM Eastern the evening before. Every
-- stored sunset moves to 00:00 Eastern on the same calendar day (its UTC date): 04:00 UTC when daylight
-- time is on at that midnight, 05:00 UTC when it isn't. US daylight time starts on the second Sunday in
-- March and ends on the first Sunday in November, both at 02:00, so a day's midnight is in it when the
-- day comes after the second Sunday in March and no later than the first Sunday in November. A sunset
-- already at 00:00 Eastern keeps its value, so running this twice changes nothing.
--
-- A passed sunset is final (decision 0002), and one still to come has been promised to consumers: a
-- sunset the move would carry across "now" keeps its instant. "Now" is the demo clock, real time plus
-- settings.clock_offset_days, as server/clock.ts reads it. Audit rows and consumer notices keep what they
-- recorded: a record with no `sunsetDay` is read by the rule it was written under (`recordedSunsetDay`).
WITH `clock`(`now_ms`) AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000
    + CAST(COALESCE((SELECT `value` FROM `settings` WHERE `key` = 'clock_offset_days'), 0) AS REAL) * 86400000
),
`dated`(`id`, `old_ms`, `day`) AS (
  SELECT `id`, `sunset_at`, date(`sunset_at` / 1000, 'unixepoch') FROM `versions` WHERE `sunset_at` IS NOT NULL
),
`moved`(`id`, `old_ms`, `new_ms`) AS (
  SELECT `id`, `old_ms`,
    CAST(strftime('%s', `day`) AS INTEGER) * 1000
      + CASE
          WHEN `day` > date(substr(`day`, 1, 4) || '-03-01', 'weekday 0', '+7 days')
           AND `day` <= date(substr(`day`, 1, 4) || '-11-01', 'weekday 0')
          THEN 4 * 3600000
          ELSE 5 * 3600000
        END
  FROM `dated`
)
UPDATE `versions`
SET `sunset_at` = `moved`.`new_ms`
FROM `moved`, `clock`
WHERE `versions`.`id` = `moved`.`id`
  AND `moved`.`new_ms` <> `moved`.`old_ms`
  AND (`moved`.`old_ms` <= `clock`.`now_ms`) = (`moved`.`new_ms` <= `clock`.`now_ms`);
