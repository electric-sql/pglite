import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

export interface AgeOptions {
  /**
   * Whether to automatically set search_path to include ag_catalog.
   * Default: false (use fully-qualified names for safety)
   */
  setSearchPath?: boolean
}

const setup = async (
  pg: PGliteInterface,
  emscriptenOpts: any,
  clientOnly?: boolean,
) => {
  // The init function runs CREATE EXTENSION, LOAD, and hook verification.
  // This must run in BOTH modes:
  // - Main thread: pg is the actual PGlite instance
  // - Worker client: pg is PGliteWorker which proxies commands to the worker
  const init = async () => {
    // Create the AGE extension
    await pg.exec('CREATE EXTENSION IF NOT EXISTS age;')

    // AGE requires explicit LOAD to activate parser hooks.
    // This is different from extensions like pg_ivm which can lazy-load.
    // AGE's post_parse_analyze_hook must be active BEFORE parsing any Cypher queries.
    await pg.exec("LOAD 'age';")

    // CRITICAL: AGE's internal C code (label_commands.c) creates indexes using
    // operator class names WITHOUT schema qualification (e.g., "graphid_ops").
    // PostgreSQL must be able to find these in search_path.
    // We prepend ag_catalog to ensure AGE functions work correctly.
    await pg.exec('SET search_path = ag_catalog, "$user", public;')

    // Verify hooks are active by attempting a simple cypher parse.
    // This validates that post_parse_analyze_hook is working.
    try {
      await pg.exec(`
        SELECT * FROM ag_catalog.cypher('__age_init_test__', $$ 
          RETURN 1 
        $$) as (v ag_catalog.agtype);
      `)
    } catch (e: unknown) {
      const error = e as Error
      const message = error.message || ''

      // Expected error: graph doesn't exist (we haven't created it)
      // This confirms the Cypher parser IS working (hooks active)
      if (message.includes('does not exist')) {
        // This is the expected case - hooks are working, graph just doesn't exist
        return
      }

      // Syntax error means hooks failed to activate - Cypher wasn't parsed
      if (message.includes('syntax error')) {
        throw new Error(
          'AGE hooks failed to initialize. LOAD may not have worked. ' +
            'Cypher syntax was not recognized.',
        )
      }

      // Any other error is unexpected and should be propagated
      // Examples: permission denied, out of memory, connection errors
      throw new Error(`AGE initialization failed unexpectedly: ${message}`)
    }
  }

  // In client-only mode (worker client), skip bundlePath/emscriptenOpts
  // but still provide init for hook activation
  if (clientOnly) {
    return {
      init,
    } satisfies ExtensionSetupResult
  }

  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/age.tar.gz', import.meta.url),
    init,
  } satisfies ExtensionSetupResult
}

export const age = {
  name: 'age',
  setup,
} satisfies Extension
