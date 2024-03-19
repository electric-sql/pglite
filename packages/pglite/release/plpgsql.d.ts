import { type EmPostgres } from "./postgres.js";

function loadPlpgsql(
  module: Partial<EmPostgres>,
  require?: (string) => any
): Partial<EmPostgres>;

export default loadPlpgsql;
