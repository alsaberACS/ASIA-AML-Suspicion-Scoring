import {
  pgTable,
  serial,
  integer,
  text,
  doublePrecision,
  boolean,
  jsonb,
  date,
  index,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";
import { bankFilesTable } from "./bankFiles";

export const transactionsTable = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => bankFilesTable.id, { onDelete: "cascade" }),
    bank: text("bank").notNull(),
    accountId: text("account_id").notNull(),
    rowIndex: integer("row_index").notNull().default(0),
    postingDate: date("posting_date", { mode: "string" }).notNull(),
    direction: text("direction").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("KWD"),
    amountKwd: doublePrecision("amount_kwd").notNull(),
    channel: text("channel").notNull().default("other"),
    counterpartyName: text("counterparty_name"),
    counterpartyBank: text("counterparty_bank"),
    counterpartyCountry: text("counterparty_country"),
    narrative: text("narrative"),
    runningBalance: doublePrecision("running_balance"),
    isInternalTransfer: boolean("is_internal_transfer").notNull().default(false),
    internalPairId: integer("internal_pair_id"),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
  },
  (t) => [
    index("transactions_case_date_idx").on(t.caseId, t.postingDate),
    index("transactions_file_idx").on(t.fileId),
  ],
);

export type TransactionRow = typeof transactionsTable.$inferSelect;
export type InsertTransaction = typeof transactionsTable.$inferInsert;
