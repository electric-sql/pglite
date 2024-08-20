import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { auto_explain } from '../../dist/contrib/auto_explain.js'

it('auto_explain', async () => {
  const pg = new PGlite({
    extensions: {
      auto_explain,
    },
  })

  await pg.exec(`
    LOAD 'auto_explain';
    SET auto_explain.log_min_duration = '0';
    SET auto_explain.log_analyze = 'true';
  `)

  const notices = []

  await pg.query(
    `
    SELECT count(*)
    FROM pg_class, pg_index
    WHERE oid = indrelid AND indisunique;
  `,
    [],
    {
      onNotice: (msg) => {
        notices.push(msg)
      },
    },
  )

  const explainNotice = notices.find(
    (msg) => msg.routine === 'explain_ExecutorEnd',
  )

  expect(!!explainNotice).toBe(true)
})
