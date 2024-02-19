import { type EmPostgres } from "./postgres.js";

function loadPgShare(
  module: Partial<EmPostgres>,
  require?: (string) => any
): Partial<EmPostgres>;

export default loadPgShare;
