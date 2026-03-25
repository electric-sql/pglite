import { copyFiles, findAndReplaceInDir } from '@electric-sql/pglite-utils/scripts/fileUtils'

export async function doBundle() {
  await copyFiles('./release', './dist')
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs', '.map'])
}

await doBundle()