import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL("../../release/tablefunc.tar.gz", import.meta.url),
  } satisfies ExtensionSetupResult;
};

export const tablefunc = {
  name: "tablefunc",
  setup,
} satisfies Extension;
