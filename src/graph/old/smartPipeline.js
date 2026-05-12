const axios = require('axios')
const { buildContext } = require('./contextBuilder')

async function callOpenRouter(model, prompt) {
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  )

  return response.data.choices[0].message.content
}

async function runSmartPipeline(prompt) {
  console.log('\n=== BUILDING CONTEXT ===')

  const context = await buildContext(prompt)

  console.log('CONTEXT READY')

  console.log('\n=== RUNNING AI ===')

  const result = await callOpenRouter(
    'deepseek/deepseek-chat',
    `
You are analyzing a REAL repository.

RELEVANT CONTEXT:

${context}

TASK:

${prompt}
`
  )

  return result
}

module.exports = {
  runSmartPipeline,
}