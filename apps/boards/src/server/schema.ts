import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true }).notNull();

// Better Auth core tables. The object keys below are the model names the adapter looks up.
export const user = pgTable("boards_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const session = pgTable("boards_session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("session_value").notNull().unique(),
  expiresAt: time("expires_at"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
export const account = pgTable("boards_account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_value"),
  refreshToken: text("refresh_value"),
  idToken: text("id_value"),
  password: text("password_hash"),
  scope: text("scope"),
  accessTokenExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const verification = pgTable("boards_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const authSchema = { user, session, account, verification };

export const BOARD_ROLES = ["owner", "editor", "viewer"] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const boards = pgTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Excalidraw elements plus the few persisted app-state fields. */
  scene: jsonb("scene").$type<unknown>().notNull(),
  /** Optimistic-concurrency counter, incremented by every accepted scene save. */
  revision: integer("revision").notNull(),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const boardMembers = pgTable(
  "board_members",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<BoardRole>().notNull(),
    createdAt: time("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.userId] }),
    index("board_members_user").on(table.userId),
  ],
);
/** Images referenced by a scene, kept as data URLs keyed by their Excalidraw file id. */
export const boardFiles = pgTable(
  "board_files",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    fileId: text("file_id").notNull(),
    mimeType: text("mime_type").notNull(),
    dataUrl: text("data_url").notNull(),
    size: integer("size").notNull(),
    createdAt: time("created_at"),
  },
  (table) => [primaryKey({ columns: [table.boardId, table.fileId] })],
);
export const schema = { ...authSchema, boards, boardMembers, boardFiles };
