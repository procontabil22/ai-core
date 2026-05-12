function createSemanticChunks(files) {
  const chunks = []

  for (const file of files) {
    if (!file.content) continue

    const content = file.content

    const chunkSize = 5000

    for (let i = 0; i < content.length; i += chunkSize) {
      const part = content.slice(i, i + chunkSize)

      chunks.push({
        file: file.file,
        content: part,
      })
    }
  }

  return chunks
}

module.exports = {
  createSemanticChunks,
}