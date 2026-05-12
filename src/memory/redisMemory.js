const redis = require('redis')

const client = redis.createClient({
  socket: {
    host: 'localhost',
    port: 6380,
  },
})

client.on('error', err => {
  console.log('REDIS ERROR:', err.message)
})

async function connectRedis() {
  if (!client.isOpen) {
    await client.connect()

    console.log('REDIS CONNECTED')
  }
}

async function saveSession(sessionId, data) {
  await connectRedis()

  await client.set(
    `session:${sessionId}`,
    JSON.stringify(data)
  )
}

async function loadSession(sessionId) {
  await connectRedis()

  const data = await client.get(
    `session:${sessionId}`
  )

  if (!data) return null

  return JSON.parse(data)
}

async function appendConversation(
  sessionId,
  message
) {
  await connectRedis()

  const current =
    await loadSession(sessionId)

  const history = current || []

  history.push(message)

  await saveSession(sessionId, history)

  return history
}

module.exports = {
  saveSession,
  loadSession,
  appendConversation,
}