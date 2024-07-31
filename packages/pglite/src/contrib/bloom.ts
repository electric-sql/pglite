import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL("../../release/bloom.tar.gz", import.meta.url),
  } satisfies ExtensionSetupResult;
};

export const bloom = {
  name: "bloom",
  setup,
} satisfies Extension;
