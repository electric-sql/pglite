import type { EmPostgres } from "../../release/postgres.js";
import type { PGlite } from "../pglite.js";

export type ExtensionLoadFn = (em: Partial<EmPostgres>) => Promise<Partial<EmPostgres>>;
export type ExtensionInitFn = (pglite: PGlite) => Promise<void>;
export type ExtensionDataUrlsFn = () => Promise<{ [filename: string]: string }>;

export interface Extension {
  name: string;
  load?: ExtensionLoadFn;
  init?: ExtensionInitFn;
  dataUrls?: ExtensionDataUrlsFn;
}
