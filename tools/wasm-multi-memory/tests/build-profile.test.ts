import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const buildScript = resolve(
  import.meta.dirname,
  '../../../postgres-pglite/build-pglite.sh',
)
const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((workspace) => rm(workspace, { recursive: true, force: true })),
  )
})

describe('PostgreSQL build profiles', () => {
  it('configures a fresh checkout without cleaning its placeholder Makefile', async () => {
    const workspace = await fixture()
    await runBuild(workspace, '/first-install')
    expect(await readFile(join(workspace, 'make.log'), 'utf8')).not.toContain(
      'make clean',
    )
    expect(await readFile(join(workspace, 'configure.log'), 'utf8')).toContain(
      '--prefix=/first-install',
    )
  })

  it('reuses a matching configured profile', async () => {
    const workspace = await fixture()
    await runBuild(workspace, '/first-install')
    await runBuild(workspace, '/first-install')
    expect(
      (await readFile(join(workspace, 'configure.log'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(1)
    expect(await readFile(join(workspace, 'make.log'), 'utf8')).not.toContain(
      'make clean',
    )
  })

  it('cleans and reconfigures when the installation directory changes', async () => {
    const workspace = await fixture()
    await runBuild(workspace, '/first-install')
    await runBuild(workspace, '/second-install')
    const configurations = (
      await readFile(join(workspace, 'configure.log'), 'utf8')
    )
      .trim()
      .split('\n')
    expect(configurations).toHaveLength(2)
    expect(configurations[1]).toContain('--prefix=/second-install')
    expect(await readFile(join(workspace, 'make.log'), 'utf8')).toContain(
      'make clean',
    )
  })

  it('reconfigures when the image compiler flags change', async () => {
    const workspace = await fixture()
    await runBuild(workspace, '/first-install')
    await runBuild(workspace, '/first-install', '-matomics -mbulk-memory')
    expect(
      (await readFile(join(workspace, 'configure.log'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(2)
    expect(await readFile(join(workspace, 'make.log'), 'utf8')).toContain(
      'make clean',
    )
  })

  it('reconfigures when the embedded package version changes', async () => {
    const workspace = await fixture()
    await runBuild(workspace, '/first-install', '', '1.0.0')
    await runBuild(workspace, '/first-install', '', '1.0.1')
    expect(
      (await readFile(join(workspace, 'configure.log'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(2)
  })
})

it('keeps the native provider policy external and preserves recursive suite paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'pglite-native-make-'))
  workspaces.push(workspace)
  const adapter = resolve(
    import.meta.dirname,
    '../../../tests/postmaster/native-build.mk',
  )
  const makefile = join(workspace, 'Makefile')
  await writeFile(
    makefile,
    `abs_top_builddir := ${workspace}
top_builddir = .
srcdir = .
bindir = /bin
libdir = /lib
with_temp_install = WRONG
pg_regress_check = WRONG
pg_isolation_regress_check = WRONG
_create_recursive_target = WRONG
.PHONY: submake-generated-headers temp-install print
submake-generated-headers temp-install: ; @:
$(eval $(call _create_recursive_target,check,child,check))
print:
\t$(file >${workspace}/commands.txt,$(pg_regress_check) $(pg_isolation_regress_check))
\t@:
`,
  )
  for (const suffix of ['', 'src/test']) {
    const cwd = join(workspace, suffix)
    await mkdir(cwd, { recursive: true })
    const options = {
      cwd,
      env: {
        ...process.env,
        MAKEFILES: adapter,
        PGLITE_TEST_PROVIDER: '/provider',
        PGLITE_TEST_CAPABILITY_RUNNER: '/bin/echo',
      },
    }
    const { stdout } = await execute(
      'make',
      ['-s', '-f', makefile, 'check', 'MAKE=/bin/echo'],
      options,
    )
    expect(stdout).toContain(
      `--suite ${suffix ? `${suffix}/` : ''}child --target check -- /bin/echo -C child check`,
    )
    await execute('make', ['-s', '-f', makefile, 'print'], options)
    const commands = await readFile(join(workspace, 'commands.txt'), 'utf8')
    expect(commands).not.toContain('WRONG')
    expect(commands).toContain('--bindir=/provider/bin')
    expect(commands).toContain('PATH="/provider/bin:')
  }
})

async function fixture(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'pglite-build-profile-'))
  workspaces.push(workspace)
  const commands = join(workspace, 'commands')
  await mkdir(commands)
  await mkdir(join(workspace, 'pglite/src/pglitec'), { recursive: true })
  await mkdir(join(workspace, 'pglite/tools/memory-placement'), {
    recursive: true,
  })
  await writeFile(
    join(workspace, 'pglite/tools/memory-placement/cc.mjs'),
    'if (process.argv[2] === "--pglite-fingerprint") console.log("fixture-policy")\n',
  )
  await writeFile(join(workspace, 'Makefile'), 'clean:\n\t@false\n')
  await writeFile(join(workspace, 'pglite/src/pglitec/pglitec.c'), '')
  await writeFile(join(workspace, 'pglite/src/pglitec/pglitec.h'), '')
  await writeFile(join(commands, 'emcc'), '#!/bin/sh\ntouch pglitec.o\n', {
    mode: 0o755,
  })
  await writeFile(join(commands, 'emconfigure'), '#!/bin/sh\nexec "$@"\n', {
    mode: 0o755,
  })
  await writeFile(
    join(commands, 'emmake'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUILD_TEST_MAKE_LOG"\ncase "$*" in\n  "make clean" | "make PORTNAME=emscripten -C src/backend generated-headers") exit 0 ;;\nesac\nexit 1\n',
    { mode: 0o755 },
  )
  await writeFile(
    join(workspace, 'configure'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUILD_TEST_CONFIGURE_LOG"\ntouch GNUmakefile config.status\n',
    { mode: 0o755 },
  )
  return workspace
}

async function runBuild(
  workspace: string,
  installationDirectory: string,
  compilerFlags = '',
  packageVersion = '',
): Promise<void> {
  // Stop at compilation: this suite exercises configure and profile transitions.
  await expect(
    execute('bash', [buildScript], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${join(workspace, 'commands')}:${process.env.PATH}`,
        DEBUG: 'false',
        EMCC_CFLAGS: compilerFlags,
        PGLITE_VERSION: packageVersion,
        PGLITE_INCREMENTAL: 'true',
        PGLITE_POSTMASTER: 'false',
        PGLITE_MULTI_MEMORY_PROVENANCE: 'false',
        INSTALL_FOLDER: installationDirectory,
        BUILD_TEST_MAKE_LOG: join(workspace, 'make.log'),
        BUILD_TEST_CONFIGURE_LOG: join(workspace, 'configure.log'),
      },
    }),
  ).rejects.toMatchObject({ code: 21 })
}
