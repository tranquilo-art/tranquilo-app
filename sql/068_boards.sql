-- Boards: an account's named collections of saved art. See lib/boards.ts.
--
-- board_items.item_id is a real foreign key to items.id, the same
-- source:native_id key the browser's local collection already uses. seq
-- orders a board's items by when they were saved; added_at alone ties for
-- every row of a bulk import. How many boards an account may have, and how
-- many items a board may hold, is enforced in lib/boards.ts from config.toml,
-- not here. Idempotent.

CREATE TABLE IF NOT EXISTS boards (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS boards_user_idx ON boards (user_id);

CREATE TABLE IF NOT EXISTS board_items (
  board_id  BIGINT      NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  item_id   TEXT        NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  seq       BIGINT      GENERATED ALWAYS AS IDENTITY,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, item_id)
);

CREATE INDEX IF NOT EXISTS board_items_board_seq_idx ON board_items (board_id, seq);

-- Verify:
--   SELECT count(*) AS boards, count(DISTINCT user_id) AS accounts FROM boards;
--   SELECT count(*) AS saved FROM board_items;
