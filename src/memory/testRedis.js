require('dotenv').config()

const {
  saveSession,
  loadSession,
  appendConversation,
} = require('./redisMemory')

async function run() {
  await saveSession('test-user', {
    project: 'taxmind',
    lastTask: 'multi-tenant auth',
  })

  console.log('SESSION SAVED')

  const session = await loadSession('test-user')

  console.log('\nLOADED SESSION:\n')

  console.log(session)

  await appendConversation('test-user-chat', {
    role: 'user',
    content: 'continue authentication module',
  })

  const history = await loadSession('test-user-chat')

  console.log('\nCHAT HISTORY:\n')

  console.log(history)
}

run()