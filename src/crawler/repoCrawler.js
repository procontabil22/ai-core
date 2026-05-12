const fg = require('fast-glob')
const fs = require('fs')
const path = require('path')

async function crawlRepository(repositoryPath) {
  const files = await fg(
    [
      '**/*.js',
      '**/*.ts',
      '**/*.tsx',
      '**/*.jsx',
      '**/*.prisma',
    ],
    {
      cwd: repositoryPath,
      absolute: true,
      ignore: [
        '**/node_modules/**',
        '**/.next/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
      ],
    }
  )

  const results = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8')

      results.push({
        file: path.relative(repositoryPath, file),
        content,
      })
    } catch (err) {
      console.log('ERROR:', file)
    }
  }

  return results
}

module.exports = {
  crawlRepository,
}