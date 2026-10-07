-- Additive only. Apply to the intended Turso database before enabling ratings.
-- No existing tables or rows are modified. Do not run from application requests.
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS MapRatings (
  map TEXT NOT NULL CHECK (length(map) BETWEEN 1 AND 128),
  steamid TEXT NOT NULL CHECK (length(steamid) = 17 AND steamid NOT GLOB '*[^0-9]*'),
  stars INTEGER NOT NULL CHECK (typeof(stars) = 'integer' AND stars BETWEEN 1 AND 5),
  PRIMARY KEY (map, steamid)
);
COMMIT;
