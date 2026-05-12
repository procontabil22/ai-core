const path = require('path')
const { crawlRepository } = require('../crawler/repoCrawler')
const { createSemanticChunks } = require('../crawler/semanticChunks')
const { semanticSearch } = require('../crawler/semanticSearch')
const { searchSimilar, storeChunks, createCollection } = require('../memory/vectorMemory')
const { saveSession, loadSession } = require('../memory/redisMemory')

const MAX_CONTEXT_CHARS = 12000

const repositories = [
  path.resolve(__dirname, '../../taxmind'),
  path.resolve(__dirname, '../../talktoexpress'),
]

async function buildContextLocal(query) {
  let allChunks = []

  for (const repo of repositories) {
    console.log(`[contextBuilder] CRAWLING (local): ${repo}`)
    try {
      const files = await crawlRepository(repo)
      const chunks = createSemanticChunks(files)
      allChunks = [...allChunks, ...chunks]
    } catch (err) {
      console.warn(`[contextBuilder] ⚠ Repositório inacessível: ${repo} — ${err.message}`)
    }
  }

  console.log(`[contextBuilder] TOTAL CHUNKS (local): ${allChunks.length}`)

  const results = semanticSearch(allChunks, query)

  console.log(`[contextBuilder] RELEVANT CHUNKS: ${results.length}`)

  return results
    .map(r => `FILE: ${r.file}\n\n${r.content}`)
    .join('\n\n---\n\n')
    .slice(0, MAX_CONTEXT_CHARS)
}

async function buildContextVector(query) {
  console.log('[contextBuilder] BUSCANDO no Qdrant...')

  const results = await searchSimilar(query)

  if (!results || results.length === 0) {
    console.log('[contextBuilder] Qdrant sem resultados — reindexando...')
    await indexAllRepositories()
    return buildContextVector(query)
  }

  console.log(`[contextBuilder] QDRANT RESULTADOS: ${results.length}`)

  return results
    .map(r => `FILE: ${r.file}\n\n${r.content}`)
    .join('\n\n---\n\n')
    .slice(0, MAX_CONTEXT_CHARS)
}

async function indexAllRepositories() {
  console.log('[contextBuilder] INDEXANDO repositórios no Qdrant...')

  try {
    await createCollection()
  } catch (_) {}

  let allChunks = []

  for (const repo of repositories) {
    console.log(`[contextBuilder] INDEXANDO: ${repo}`)
    try {
      const files = await crawlRepository(repo)
      const chunks = createSemanticChunks(files)
      allChunks = [...allChunks, ...chunks]
    } catch (err) {
      console.warn(`[contextBuilder] ⚠ Erro ao indexar ${repo}: ${err.message}`)
    }
  }

  await storeChunks(allChunks)
  console.log(`[contextBuilder] INDEXADOS: ${allChunks.length} chunks`)
}

async function buildContext(query, options = {}) {
  const { sessionId, useVector = false } = options

  // Tenta cache Redis primeiro
  if (sessionId) {
    const cached = await loadSession(`ctx:${sessionId}:${query.slice(0, 40)}`).catch(() => null)
    if (cached) {
      console.log(`[contextBuilder] CACHE HIT — session ${sessionId}`)
      return cached
    }
  }

  let context

  if (useVector) {
    try {
      context = await buildContextVector(query)
    } catch (err) {
      console.warn(`[contextBuilder] Qdrant falhou (${err.message}) — usando busca local`)
      context = await buildContextLocal(query)
    }
  } else {
    context = await buildContextLocal(query)
  }

  console.log(`[contextBuilder] CONTEXT SIZE: ${context.length} chars`)

  // Salva no Redis se tiver sessionId
  if (sessionId && context) {
    await saveSession(`ctx:${sessionId}:${query.slice(0, 40)}`, context).catch(() => {})
  }

  return context
}

module.exports = {
  buildContext,
  indexAllRepositories,
}
