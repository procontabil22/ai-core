const { crawlRepository } = require('./repoCrawler')
const { createSemanticChunks } = require('./semanticChunks')
const { semanticSearch } = require('./semanticSearch')

async function main() {
  const repository = await crawlRepository('../')

  const chunks = createSemanticChunks(repository)

  console.log('\nTOTAL CHUNKS:')
  console.log(chunks.length)

  const results = semanticSearch(
    chunks,
    'jwt authentication prisma'
  )

  console.log('\nSEARCH RESULTS:')
  console.log(results)
}

main()