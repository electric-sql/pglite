import type { Extension, ExtensionLoadFn } from "./interface.js";
import { nodeValues } from "../utils.js";
import loadPlpgsql from "../../release/plpgsql.js";

const DATA_URL = new URL("../release/plpgsql.data", import.meta.url);

const name = "plpgsql";

const load: ExtensionLoadFn = async (em) => {
  const { require } = await nodeValues();
  loadPlpgsql(em, require);
  return em;
};

const dataUrls = async () => {
  return { "plpgsql.data": DATA_URL.toString() };
}

export default { name, load, dataUrls } as Extension;
