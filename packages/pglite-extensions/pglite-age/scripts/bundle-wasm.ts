import { copyFiles, findAndReplaceInDir } from '@electric-sql/pglite-utils/scripts/fileUtils'

async function main() {
  await copyFiles('./release', './dist')
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
}

await main()
