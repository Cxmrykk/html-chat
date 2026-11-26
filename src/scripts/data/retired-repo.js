import * as idb from './idb.js';
import { RETIRED_KEYS, RETIRED_PREFIXES } from './keys.js';

/**
 * Deletes the records of features that no longer exist. Idempotent, and
 * close to free once there is nothing left to delete.
 */
export async function purgeRetiredData() {
  for (const key of RETIRED_KEYS) await idb.remove(key);
  for (const prefix of RETIRED_PREFIXES) await idb.removeByPrefix(prefix);
}
