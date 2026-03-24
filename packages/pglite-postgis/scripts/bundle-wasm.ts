import { pglFileUtils } from '@electric-sql/pglite-utils'

async function main() {
  await pglFileUtils.copyFiles('./release', './dist')
  await pglFileUtils.findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
}

await main()
