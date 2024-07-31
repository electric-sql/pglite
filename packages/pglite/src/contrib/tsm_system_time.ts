import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL("../../release/tsm_system_time.tar.gz", import.meta.url),
  } satisfies ExtensionSetupResult;
};

export const tsm_system_time = {
  name: "tsm_system_time",
  setup,
} satisfies Extension;
