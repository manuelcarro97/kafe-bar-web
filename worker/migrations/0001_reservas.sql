CREATE TABLE reservations (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, turn TEXT NOT NULL, time TEXT NOT NULL,
  people INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  menu INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, deadline TEXT, created_at TEXT NOT NULL
);
CREATE TABLE reservation_tables (
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  table_label TEXT NOT NULL, date TEXT NOT NULL, turn TEXT NOT NULL, status TEXT NOT NULL
);
CREATE UNIQUE INDEX one_booking_per_table
  ON reservation_tables(table_label, date, turn) WHERE status IN ('pending','confirmed');
CREATE TABLE day_overrides (key TEXT PRIMARY KEY, kind TEXT NOT NULL);
