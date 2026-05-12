const { crawlRepository } = require('./repoCrawler')

async function main() {
  const repository = await crawlRepository('../')

  console.log('\nFILES FOUND:')
  console.log(repository.length)

  console.log('\nFIRST FILE:')
  console.log(repository[0])
}

main()