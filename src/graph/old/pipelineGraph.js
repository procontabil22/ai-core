const axios = require('axios')

const GLOBAL_LANGUAGE_RULES = `
IMPORTANT:
- Always respond in Brazilian Portuguese (pt-BR)
- Technical explanations must be in pt-BR
- Architecture analysis must be in pt-BR
- Reviews must be in pt-BR
- Keep source code in English
- Keep variable names in English
- Keep framework/library names in English
- Prefer concise enterprise-level communication
`

const PREMIUM_TRIGGERS = [
  'critical',
  'enterprise',
  'security',
  'distributed',
  'multi-tenant',
  'autenticação',
  'auth',
  'prisma',
  'payment',
  'pagamento',
]

function isPremiumPrompt(prompt) {
  const lower = prompt.toLowerCase()
  return PREMIUM_TRIGGERS.some(t => lower.includes(t))
}

async function callOpenRouter(model, prompt, label = '') {
  const startTime = Date.now()

  if (label) {
    console.log(`\n[${label}] MODEL: ${model}`)
    console.log(`[${label}] PROMPT SIZE: ${prompt.length} chars`)
  }

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  )

  const result = response.data.choices[0].message.content
  const modelUsed = response.data.model
  const usage = response.data.usage
  const duration = Date.now() - startTime

  if (label) {
    console.log(`[${label}] MODEL USED:    ${modelUsed}`)
    console.log(`[${label}] TOKENS IN:     ${usage?.prompt_tokens ?? '?'}`)
    console.log(`[${label}] TOKENS OUT:    ${usage?.completion_tokens ?? '?'}`)
    console.log(`[${label}] DURATION:      ${duration}ms`)
    console.log(`[${label}] RESPONSE SIZE: ${result.length} chars`)

    if (modelUsed !== model) {
      console.warn(`[${label}] ⚠ FALLBACK DETECTADO: solicitado=${model} usado=${modelUsed}`)
    }

    if (!result || result.length < 50) {
      throw new Error(`[${label}] Resposta inválida (${result?.length ?? 0} chars)`)
    }
  }

  return { content: result, modelUsed, duration, usage }
}

async function runPipeline(prompt, context) {
  const timings = {}
  const models = {}

  console.log('\n=== PIPELINE GRAPH — 6 ESTÁGIOS ===')

  // ESTÁGIO 1 — GEMINI PLANNER
  const t1 = Date.now()
  const stage1 = await callOpenRouter(
    'google/gemini-2.5-flash',
    `${GLOBAL_LANGUAGE_RULES}

Analyze this repository context and create implementation stages.

REPOSITORY CONTEXT:
${context}

TASK:
${prompt}`,
    'STAGE 1 PLANNER'
  )
  timings.stage1_ms = Date.now() - t1
  models.planner = stage1.modelUsed

  // ESTÁGIO 2 — GEMINI PARSER
  const t2 = Date.now()
  const stage2 = await callOpenRouter(
    'google/gemini-2.5-flash',
    `${GLOBAL_LANGUAGE_RULES}

Structure and organize this implementation plan.

PLAN:
${stage1.content}`,
    'STAGE 2 PARSER'
  )
  timings.stage2_ms = Date.now() - t2
  models.parser = stage2.modelUsed

  // ESTÁGIO 3 — DEEPSEEK IMPLEMENTER
  const t3 = Date.now()
  const stage3 = await callOpenRouter(
    'deepseek/deepseek-chat',
    `${GLOBAL_LANGUAGE_RULES}

Generate enterprise implementation based on:

${stage2.content}

REPOSITORY CONTEXT:
${context}`,
    'STAGE 3 IMPLEMENTER'
  )
  timings.stage3_ms = Date.now() - t3
  models.implementer = stage3.modelUsed

  // ESTÁGIO 4 — MINIMAX COMPRESSOR
  const t4 = Date.now()
  const stage4 = await callOpenRouter(
    'minimax/minimax-m2',
    `${GLOBAL_LANGUAGE_RULES}

Compress and optimize this implementation context:

${stage3.content}`,
    'STAGE 4 COMPRESSOR'
  )
  timings.stage4_ms = Date.now() - t4
  models.compressor = stage4.modelUsed

  // ESTÁGIO 5 — DEEPSEEK REVIEW
  const t5 = Date.now()
  const stage5 = await callOpenRouter(
    'deepseek/deepseek-chat',
    `${GLOBAL_LANGUAGE_RULES}

Review this implementation deeply.

Focus:
- architecture
- scalability
- security
- multi-tenant risks
- authentication
- Prisma patterns
- hidden bugs

IMPLEMENTATION:
${stage4.content}`,
    'STAGE 5 REVIEW'
  )
  timings.stage5_ms = Date.now() - t5
  models.review1 = stage5.modelUsed

  // ESTÁGIO 6 — SONNET PREMIUM (condicional)
  let finalContent = stage5.content
  let premiumActivated = false
  timings.stage6_ms = null
  models.review2 = models.review1

  if (isPremiumPrompt(prompt)) {
    console.log('\n[STAGE 6] ★ Premium ativado → Sonnet')
    premiumActivated = true

    const t6 = Date.now()
    const stage6 = await callOpenRouter(
      'anthropic/claude-sonnet-4-5',
      `${GLOBAL_LANGUAGE_RULES}

Perform a PREMIUM enterprise review.

DEEPSEEK REVIEW:
${stage5.content}

IMPLEMENTATION:
${stage4.content}

Focus:
- enterprise architecture
- distributed systems
- scalability
- concurrency
- race conditions
- hidden security flaws
- multi-tenant isolation`,
      'STAGE 6 PREMIUM'
    )
    timings.stage6_ms = Date.now() - t6
    models.review2 = stage6.modelUsed
    finalContent = stage6.content
  } else {
    console.log('\n[STAGE 6] Prompt padrão → sem premium')
  }

  const totalMs = Object.values(timings).reduce((a, b) => (b ? a + b : a), 0)

  console.log('\n=== PIPELINE CONCLUÍDO ===')
  console.log(`TOTAL: ${totalMs}ms`)
  console.log(`PREMIUM: ${premiumActivated}`)
  console.log('MODELS:', models)

  return {
    finalContent,
    premiumActivated,
    models,
    timings,
    totalMs,
    stages: {
      planning: stage1.content.slice(0, 1000),
      parsed: stage2.content.slice(0, 1000),
      implementation: stage3.content.slice(0, 1000),
      compressed: stage4.content.slice(0, 1000),
      review: stage5.content.slice(0, 1000),
      final: finalContent.slice(0, 1000),
    },
  }
}

module.exports = {
  runPipeline,
  isPremiumPrompt,
}
