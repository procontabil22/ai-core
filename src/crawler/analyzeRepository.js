const { crawlRepository } = require('./repoCrawler')

async function analyzeRepository() {
  const repository = await crawlRepository('../')

  const analysis = {
    totalFiles: repository.length,
    nestjs: false,
    nextjs: false,
    prisma: false,
    react: false,
    typescript: false,
  }

  for (const file of repository) {
    const filename = file.file.toLowerCase()

    if (filename.includes('nestjs')) analysis.nestjs = true
    if (filename.includes('next.config')) analysis.nextjs = true
    if (filename.includes('schema.prisma')) analysis.prisma = true
    if (filename.endsWith('.tsx')) analysis.react = true
    if (filename.endsWith('.ts')) analysis.typescript = true
  }

  console.log('\n=== REPOSITORY ANALYSIS ===')
  console.log(analysis)
}

analyzeRepository()