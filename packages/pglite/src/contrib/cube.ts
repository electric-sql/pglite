import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL("../../release/cube.tar.gz", import.meta.url),
  } satisfies ExtensionSetupResult;
};

export const cube = {
  name: "cube",
  setup,
} satisfies Extension;
