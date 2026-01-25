import * as fs from 'fs/promises'
import * as path from 'path'

async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string,
): Promise<void> {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}

async function findAndReplaceInDir(
  dir: string,
  find: string | RegExp,
  replace: string,
  extensions: string[],
  recursive = false,
): Promise<void> {
  const files = await fs.readdir(dir, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(dir, file.name)
    if (file.isDirectory() && recursive) {
      await findAndReplaceInDir(filePath, find, replace, extensions)
    } else {
      const fileExt = path.extname(file.name)
      if (extensions.includes(fileExt)) {
        await findAndReplaceInFile(find, replace, filePath)
      }
    }
  }
}

const copyFiles = async (srcDir: string, destDir: string) => {
  await fs.mkdir(destDir, { recursive: true })
  const files = await fs.readdir(srcDir)
  for (const file of files) {
    if (file.startsWith('.')) {
      continue
    }
    const srcFile = path.join(srcDir, file)
    const destFile = path.join(destDir, file)
    const stat = await fs.stat(srcFile)
    if (stat.isFile()) {
      await fs.copyFile(srcFile, destFile)
      console.log(`Copied ${srcFile} to ${destFile}`)
    }
  }
}

async function main() {
  await copyFiles('./release', './dist')
  await findAndReplaceInDir('./dist', /\.\.\/release\//g, './', ['.js', '.cjs'])
  await findAndReplaceInDir('./dist/contrib', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/vector', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_ivm', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pgtap', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/pg_uuidv7', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir('./dist/age', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
  await findAndReplaceInDir(
    './dist',
    `require("./postgres.js")`,
    `require("./postgres.cjs").default`,
    ['.cjs'],
  )
  await findAndReplaceInDir('./dist/pg_hashids', /\.\.\/release\//g, '', ['.js', '.cjs'])
}

await main()
