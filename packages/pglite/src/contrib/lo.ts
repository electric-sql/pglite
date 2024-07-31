import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL("../../release/lo.tar.gz", import.meta.url),
  } satisfies ExtensionSetupResult;
};

export const lo = {
  name: "lo",
  setup,
} satisfies Extension;
