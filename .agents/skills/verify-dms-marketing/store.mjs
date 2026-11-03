import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {import("./marketing.mjs").Ctx} Ctx
 * @typedef {Record<string, unknown>} Doc
 * @typedef {{ find: (filter: Doc) => { toArray: () => Promise<Doc[]> }, updateMany: (filter: Doc, update: Doc) => Promise<{ matchedCount: number }>, deleteMany: (filter: Doc) => Promise<{ deletedCount: number }>, insertOne: (doc: Doc) => Promise<unknown>, countDocuments: (filter: Doc) => Promise<number> }} Collection
 * @typedef {{ collection: (name: string) => Collection, listCollections: () => { toArray: () => Promise<{ name: string }[]> } }} Database
 * @typedef {{ connect: () => Promise<unknown>, db: (name: string) => Database, close: () => Promise<void> }} Client
 * @typedef {{ MongoClient: new (url: string, options?: Record<string, unknown>) => Client }} Driver
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DMS_PACKAGE = join(HERE, "../../../packages/dms-marketing/node_modules/@antelopejs/dms/package.json");

/** Milliseconds in a day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {unknown} value A module namespace
 * @returns {value is Driver} Whether it is the MongoDB driver
 */
function isDriver(value) {
  return typeof value === "object" && value !== null && "MongoClient" in value && typeof value.MongoClient === "function";
}

/**
 * The MongoDB driver dms-control itself uses to drop a journey's database.
 *
 * @returns {Promise<Driver>} The driver
 */
async function driver() {
  const resolved = createRequire(DMS_PACKAGE).resolve("mongodb");
  /** @type {unknown} */
  const loaded = await import(pathToFileURL(resolved).href);
  if (isDriver(loaded)) return loaded;
  throw new Error("the MongoDB driver dms-control resolves has no MongoClient");
}

/**
 * Runs `body` with the collections of one module table in the run's database (a table can live in one collection
 * per tenant, so every collection whose name ends with the table's name is given).
 *
 * @template T
 * @param {Ctx} ctx The journey
 * @param {string} table The table, such as `marketing_events`
 * @param {(collections: Collection[], database: Database) => Promise<T>} body What to do
 * @returns {Promise<T>} Its result
 */
export async function withTable(ctx, table, body) {
  const { MongoClient } = await driver();
  const client = new MongoClient(ctx.state.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    const database = client.db(ctx.state.database);
    const names = (await database.listCollections().toArray()).map((entry) => entry.name).filter((name) => name === table || name.endsWith(`_${table}`) || name.endsWith(`.${table}`) || name.endsWith(table));
    return await body(names.map((name) => database.collection(name)), database);
  } finally {
    await client.close();
  }
}

/**
 * The stored rows of a table that match a filter.
 *
 * @param {Ctx} ctx The journey
 * @param {string} table The table
 * @param {Doc} [filter] The filter
 * @returns {Promise<Doc[]>} The rows
 */
export function rows(ctx, table, filter = {}) {
  return withTable(ctx, table, async (collections) => (await Promise.all(collections.map((collection) => collection.find(filter).toArray()))).flat());
}

/**
 * Moves stored rows back in time or edits them: no request can age an event or a snapshot.
 *
 * @param {Ctx} ctx The journey
 * @param {string} table The table
 * @param {Doc} filter Which rows
 * @param {Doc} set The fields to set
 * @returns {Promise<number>} How many rows matched
 */
export function edit(ctx, table, filter, set) {
  return withTable(ctx, table, async (collections) => {
    let matched = 0;
    for (const collection of collections) matched += (await collection.updateMany(filter, { $set: set })).matchedCount;
    return matched;
  });
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} table The table
 * @param {Doc} [filter] Which rows
 * @returns {Promise<number>} How many rows match
 */
export function count(ctx, table, filter = {}) {
  return withTable(ctx, table, async (collections) => {
    let total = 0;
    for (const collection of collections) total += await collection.countDocuments(filter);
    return total;
  });
}
