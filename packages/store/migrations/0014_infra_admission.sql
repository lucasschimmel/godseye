CREATE TABLE infrastructure_admission (
  id integer PRIMARY KEY CHECK (id=1),
  state text NOT NULL CHECK (state IN ('open','paused')),
  revision integer NOT NULL CHECK (revision >= 0),
  reason text,
  updated_at timestamptz
);
INSERT INTO infrastructure_admission VALUES (1,'open',0,NULL,NULL);
