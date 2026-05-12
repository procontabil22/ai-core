const { QdrantClient } = require('@qdrant/js-client-rest')
const axios = require('axios')
const { v4: uuid } = require('uuid')

const client = new QdrantClient({
  url: 'http://localhost:6333',
})

const COLLECTION = 'repository_memory'

async function createCollection() {
  try {
    await client.createCollection(COLLECTION, {
      vectors: {
        size: 1536,
        distance: 'Cosine',
      },
    })

    console.log('Qdrant collection created')
  } catch (err) {
    console.log('Collection already exists')
  }
}

async function createEmbedding(text) {
  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: 'text-embedding-3-small',
      input: text,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  )

  return response.data.data[0].embedding
}

async function storeChunks(chunks) {
  for (const chunk of chunks) {
    const embedding = await createEmbedding(chunk.content)

    await client.upsert(COLLECTION, {
      wait: true,
      points: [
        {
          id: uuid(),
          vector: embedding,
          payload: {
            file: chunk.file,
            content: chunk.content,
          },
        },
      ],
    })
  }

  console.log(`Stored ${chunks.length} chunks`)
}

async function searchSimilar(query) {
  const embedding = await createEmbedding(query)

  const results = await client.search(COLLECTION, {
    vector: embedding,
    limit: 8,
  })

  return results.map(r => r.payload)
}

module.exports = {
  createCollection,
  storeChunks,
  searchSimilar,
}