-- A push render keeps the platform it was for ("ios" or "android"), so Usage can split pushes by phone and a
-- failed push can be traced to its phone (decision 0039). It is a setting of the request, never a variable
-- value. Null for every other channel, and for every push logged before this: those rows can't gain it later.
ALTER TABLE `render_log` ADD `platform` text;
