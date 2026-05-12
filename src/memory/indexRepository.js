require('dotenv').config()

const { crawlRepository } = require('../crawler/repoCrawler')
const { createSemanticChunks } = require('../crawler/semanticChunks')

const {
  createCollection,
  storeChunks,
} = require('./vectorMemory')

async function run() {
  try {
    console.log('\n=== VECTOR INDEXER START ===\n')

    await createCollection()

    const repositories = [
      'C:/Users/Administrador/dyad-apps/taxmind',
      'C:/Users/Administrador/dyad-apps/talktoexpress',
    ]

    let allFiles = []

    for (const repo of repositories) {
      console.log(`CRAWLING: ${repo}`)

      const files = await crawlRepository(repo)

      console.log(`FILES FOUND: ${files.length}`)

      allFiles = [...allFiles, ...files]
    }

    console.log(`\nTOTAL FILES: ${allFiles.length}`)

    const chunks = createSemanticChunks(allFiles)

    console.log(`TOTAL CHUNKS: ${chunks.length}\n`)

    if (!chunks.length) {
      console.log('NO CHUNKS FOUND')
      return
    }

    await storeChunks(chunks)

    console.log('\nVECTOR INDEX COMPLETE\n')
  } catch (error) {
    console.error('\nINDEX ERROR:\n')

    console.error(
      error.response?.data ||
      error.message ||
      error
    )
  }
}

run()