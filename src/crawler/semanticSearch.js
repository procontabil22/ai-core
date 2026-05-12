function semanticSearch(chunks, query) {
  const q = query.toLowerCase()

  return chunks
    .filter(chunk => {
      const content = chunk.content.toLowerCase()

      return q
        .split(' ')
        .some(word => content.includes(word))
    })
    .slice(0, 8)
}

module.exports = {
  semanticSearch,
}