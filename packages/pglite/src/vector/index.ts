import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL("../release/vector.tar", import.meta.url),
  } satisfies ExtensionSetupResult;
}

export const vector = {
  name: "pgvector",
  setup,
} satisfies Extension;
