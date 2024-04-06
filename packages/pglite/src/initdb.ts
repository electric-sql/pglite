import { PGDATA } from "./fs/index.js";
import EmPostgresFactory, { type EmPostgres } from "../release/postgres.js";
import loadPgShare from "../release/share.js";
import { makeLocateFile, nodeValues } from "./utils.js";
import { DebugLevel } from "./index.js";

export const DIRS = [
  "global",
  "pg_wal",
  "pg_wal/archive_status",
  "pg_commit_ts",
  "pg_dynshmem",
  "pg_notify",
  "pg_serial",
  "pg_snapshots",
  "pg_subtrans",
  "pg_twophase",
  "pg_multixact",
  "pg_multixact/members",
  "pg_multixact/offsets",
  "base",
  "base/1",
  "pg_replslot",
  "pg_tblspc",
  "pg_stat",
  "pg_stat_tmp",
  "pg_xact",
  "pg_logical",
  "pg_logical/snapshots",
  "pg_logical/mapping",
];

export const FILES = [
  "postgresql.conf",
  "postgresql.auto.conf",
  "pg_ident.conf",
  "pg_hba.conf",
];

export async function initDb(dataDir?: string, debug?: DebugLevel) {
  const debugMode = debug !== undefined && debug > 0;

  const emscriptenOpts: Partial<EmPostgres> = {
    preRun: [
      (mod: any) => {
        mod.FS.mkdir(PGDATA, 0o750);
        if (dataDir) {
          const nodefs = mod.FS.filesystems.NODEFS;
          mod.FS.mount(nodefs, { root: dataDir }, PGDATA);
        }
        for (const dir of DIRS) {
          mod.FS.mkdir(PGDATA + "/" + dir, 0o700);
        }
        for (const filename of FILES) {
          mod.FS.writeFile(PGDATA + "/" + filename, "");
        }
        mod.FS.writeFile(PGDATA + "/PG_VERSION", "15devel");
        mod.FS.writeFile(PGDATA + "/base/1/PG_VERSION", "15devel");
      },
    ],
    locateFile: await makeLocateFile(),
    ...(debugMode
      ? { print: console.info, printErr: console.error }
      : { print: () => {}, printErr: () => {} }),
    arguments: [
      "--boot",
      "-x1",
      "-X",
      "16777216",
      ...(debug ? ["-d", debug.toString()] : []),
      "-c",
      "dynamic_shared_memory_type=mmap",
      "-D",
      PGDATA,
    ],
  };

  const { require } = await nodeValues();

  loadPgShare(emscriptenOpts, require);

  const mod = await EmPostgresFactory(emscriptenOpts);
  return mod;
}
