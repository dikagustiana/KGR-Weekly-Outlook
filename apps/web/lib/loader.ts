/**
 * PRD v5.1 K41 / K42: a PostgREST error is never read as "no rows". Loaders, builders and actions take a result through
 * `must` (throws LoaderError naming the loader); a page loader wraps what feeds one tile in `tileData`, so only that
 * tile shows the error (state error, v4 §5.3) and the rest of the page stays. "belum diisi" / "tanpa basis" is only
 * for an empty result that is valid. `.in()` lists go in chunks of 200 values (URL length).
 */

/** K57 (R44): PostgREST codes that mean the database schema is behind the code. */
export const SCHEMA_ERROR_CODES = ["42703", "42883", "42P01", "PGRST202", "PGRST204"] as const;
export const isSchemaError = (code: string | undefined): boolean => !!code && (SCHEMA_ERROR_CODES as readonly string[]).includes(code);

export class LoaderError extends Error {
  constructor(readonly where: string, message: string, readonly schema = false, readonly code?: string) {
    super(`${where}: ${message}`);
    this.name = "LoaderError";
  }
}

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };

/** The data of a PostgREST result, or LoaderError(where). `null` stays null (maybeSingle without a row). */
export function must<T>(res: Res<T>, where: string): T | null {
  if (res.error) throw new LoaderError(where, res.error.message, isSchemaError(res.error.code), res.error.code);
  return res.data;
}

/**
 * R64 (K56): the parameter row of a week is an input of the numbers built from it (blast cost, selling cost, rates,
 * yields). Without it they are unknown: the build stops with the reason, it never runs on a default of 0.
 */
export function needParameter(row: unknown, where: string): Record<string, unknown> {
  if (!row) throw new LoaderError(where, "parameter minggu ini belum ada; biaya, tarif dan yield dari parameter tidak diketahui");
  return row as Record<string, unknown>;
}

/** The rows of a list result (PostgREST returns [] for none), or LoaderError(where). */
export function mustRows<T = Record<string, unknown>>(res: Res<T[]>, where: string): T[] {
  if (res.error) throw new LoaderError(where, res.error.message, isSchemaError(res.error.code), res.error.code);
  return res.data ?? [];
}

/**
 * R43 (K56): a read of a table the database does not have yet (42P01) returns [] with a log; every other error throws.
 * Only this helper may swallow a read, and only for a genuinely-not-migrated table.
 */
export function orMissingTable<T>(res: Res<T[]>, where: string): T[] {
  if (res.error) {
    if (res.error.code === "42P01") {
      console.error(`[schema] ${where}: ${res.error.message}`);
      return [];
    }
    throw new LoaderError(where, res.error.message, isSchemaError(res.error.code), res.error.code);
  }
  return res.data ?? [];
}

/** What a tile gets from its loader: the value, or the message of the error that stopped it. */
export type TileData<T> = { ok: T } | { error: string };

export const tileError = <T>(t: TileData<T>): string | null => ("error" in t ? t.error : null);
export const tileValue = <T>(t: TileData<T>, fallback: T): T => ("ok" in t ? t.ok : fallback);

/** Runs the reads of one tile; an error is logged on the server with the loader name and returned for that tile only. */
export async function tileData<T>(where: string, f: () => Promise<T>): Promise<TileData<T>> {
  try {
    return { ok: await f() };
  } catch (e) {
    // "<tile loader> — <query>: <PostgREST message>": which tile, which read, what the database said
    const message = `${where} — ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[loader] ${message}`);
    return { error: message };
  }
}

/** K42: `ids` in chunks of `size` (default 200) per request, results concatenated in chunk order. */
export async function inChunks<T, I = string>(ids: readonly I[], query: (chunk: I[]) => PromiseLike<T[]>, size = 200): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await query(ids.slice(i, i + size))));
  return out;
}
