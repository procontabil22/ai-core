const axios = require('axios')

const VISION_URL = 'http://177.7.43.80:8000/vision/analyze-base64'

const LANGUAGE_RULES = `
REGRAS OBRIGATÓRIAS:
- Responda SEMPRE em português brasileiro (pt-BR)
- Código-fonte, variáveis e nomes de frameworks permanecem em inglês
- Comunicação técnica deve ser concisa e objetiva
`

// ═══════════════════════════════════════════════════════
// MODELOS
// ═══════════════════════════════════════════════════════
const MODELS = {
  flash:   'deepseek/deepseek-v4-flash',
  v3:      'deepseek/deepseek-chat-v3-0324',
  r1:      'deepseek/deepseek-r1',
  minimax: 'minimax/minimax-m2',
  sonnet:  'anthropic/claude-sonnet-4-5',
}

// ═══════════════════════════════════════════════════════
// EMITTER DE PROGRESSO
// Aceita um callback onProgress(event) e loga no console
// ═══════════════════════════════════════════════════════
function emit(onProgress, stage, status, detail = '') {
  const icons = {
    start:   '🔄',
    done:    '✅',
    error:   '❌',
    info:    'ℹ️ ',
    warn:    '⚠️ ',
    route:   '🔀',
    vision:  '👁️ ',
    context: '📂',
  }
  const icon = icons[status] || '•'
  const msg = `${icon} [${stage}] ${detail}`
  console.log(msg)
  if (typeof onProgress === 'function') onProgress({ stage, status, detail, msg })
}

// ═══════════════════════════════════════════════════════
// CLASSIFICADOR
// ═══════════════════════════════════════════════════════
function classifyTask(prompt) {
  const p = prompt.toLowerCase()
  const isPremium = ['security','auth','jwt','autenticacao','autenticação','distributed','multi-tenant','payment','pagamento','middleware','prisma','critical','enterprise'].some(t => p.includes(t))
  const isSimple  = ['fix','corrig','erro','error','bug','typo','rename','renomear','delete','remov','adiciona import','add import'].some(t => p.includes(t))
  const isComplex = ['refactor','refatora','arquitetura','architecture','pipeline','módulo','module','implement','implemente','integra','criar','create'].some(t => p.includes(t))
  if (isPremium) return 'premium'
  if (isSimple && !isComplex) return 'simple'
  return 'complex'
}

function hasImage(prompt, imageBase64) {
  return !!imageBase64 || prompt.includes('[Image') || prompt.includes('imagem') || prompt.includes('screenshot') || prompt.includes('print')
}

// ═══════════════════════════════════════════════════════
// CHAMADA COM RETRY E FALLBACK
// ═══════════════════════════════════════════════════════
async function callModel(model, prompt, label = '', imageBase64 = null, fallback = null, onProgress = null) {
  const start = Date.now()

  const buildMessages = (content) => {
    if (imageBase64) {
      return [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: content }
      ]}]
    }
    return [{ role: 'user', content }]
  }

  const modelsToTry = [model, fallback].filter(Boolean)

  for (const currentModel of modelsToTry) {
    if (currentModel !== model) {
      emit(onProgress, label, 'warn', `Fallback → ${currentModel}`)
    }
    try {
      emit(onProgress, label, 'start', `Chamando ${currentModel}...`)

      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model: currentModel, messages: buildMessages(prompt) },
        { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 }
      )
      const content = res.data.choices[0].message.content
      const modelUsed = res.data.model
      const duration = Date.now() - start
      if (!content || content.length < 20) throw new Error('Resposta vazia')

      emit(onProgress, label, 'done', `${modelUsed} — ${duration}ms — ${content.length} chars`)
      return { content, modelUsed, duration }
    } catch (err) {
      emit(onProgress, label, 'error', `${currentModel}: ${err.message}`)
      if (currentModel === modelsToTry[modelsToTry.length - 1]) throw err
    }
  }
}

// ═══════════════════════════════════════════════════════
// VISÃO — DeepSeek V4 Flash → fallback VPS
// ═══════════════════════════════════════════════════════
async function analyzeImage(imageBase64, onProgress = null) {
  emit(onProgress, 'VISION', 'vision', 'Analisando imagem com DeepSeek V4 Flash...')
  try {
    const res = await callModel(
      MODELS.flash,
      `${LANGUAGE_RULES}
Analise esta imagem detalhadamente. Extraia:
1. Tipo de conteúdo (UI, código, documento, erro)
2. Texto visível completo
3. Componentes e elementos identificados
4. Problemas ou pontos de atenção
Responda em pt-BR.`,
      'VISION-FLASH',
      imageBase64,
      null,
      onProgress
    )
    return res.content
  } catch (err) {
    emit(onProgress, 'VISION', 'warn', 'DeepSeek falhou — usando VPS minicpm-v (gratuito)')
    const vpsRes = await axios.post(VISION_URL, { mime: 'image/png', content: imageBase64 }, { timeout: 120000 })
    return `${vpsRes.data.summary}\n\nOCR:\n${vpsRes.data.ocr}`
  }
}

// ═══════════════════════════════════════════════════════
// ROTA SIMPLES — DeepSeek V4 Flash direto
// ═══════════════════════════════════════════════════════
async function routeSimple(prompt, context, onProgress = null) {
  emit(onProgress, 'ROUTER', 'route', 'Rota SIMPLES → DeepSeek V4 Flash')
  const t = Date.now()
  const result = await callModel(
    MODELS.flash,
    `${LANGUAGE_RULES}
CONTEXTO DO REPOSITÓRIO:
${context}

TAREFA:
${prompt}

Resolva de forma direta e objetiva.`,
    'SIMPLE',
    null,
    null,
    onProgress
  )
  return {
    finalContent: result.content,
    route: 'simple',
    premiumActivated: false,
    models: { implementer: result.modelUsed },
    timings: { simple_ms: Date.now() - t },
    totalMs: Date.now() - t,
  }
}

// ═══════════════════════════════════════════════════════
// ROTA COMPLEXA — V4 Flash → V4 Flash → Minimax → DeepSeek V3
// ═══════════════════════════════════════════════════════
async function routeComplex(prompt, context, visionContext = '', onProgress = null) {
  emit(onProgress, 'ROUTER', 'route', 'Rota COMPLEXA → Flash → Flash → Minimax → V3')
  const timings = {}
  const models = {}
  const enriched = visionContext ? `${prompt}\n\nCONTEXTO VISUAL:\n${visionContext}` : prompt

  // Stage 1 — V4 Flash planeja
  emit(onProgress, 'STAGE 1/4', 'info', 'Planejamento com DeepSeek V4 Flash...')
  const t1 = Date.now()
  const plan = await callModel(MODELS.flash,
    `${LANGUAGE_RULES}
CONTEXTO DO REPOSITÓRIO:
${context}

TAREFA:
${enriched}

Crie um plano de implementação detalhado com etapas claras. NÃO implemente — apenas planeje.`,
    'PLAN-FLASH',
    null,
    null,
    onProgress
  )
  timings.plan_ms = Date.now() - t1
  models.planner = plan.modelUsed

  // Stage 2 — V4 Flash implementa
  emit(onProgress, 'STAGE 2/4', 'info', 'Implementação com DeepSeek V4 Flash...')
  const t2 = Date.now()
  const impl = await callModel(MODELS.flash,
    `${LANGUAGE_RULES}
PLANO:
${plan.content}

CONTEXTO DO REPOSITÓRIO (resumo):
${context.slice(0, 4000)}

Execute o plano gerando o código completo e funcional.`,
    'IMPL-FLASH',
    null,
    null,
    onProgress
  )
  timings.impl_ms = Date.now() - t2
  models.implementer = impl.modelUsed

  // Stage 3 — Minimax comprime
  emit(onProgress, 'STAGE 3/4', 'info', 'Compressão com Minimax M2...')
  const t3 = Date.now()
  const compressed = await callModel(MODELS.minimax,
    `${LANGUAGE_RULES}
Comprima e organize esta implementação mantendo toda a lógica essencial.
Elimine redundâncias, organize o código de forma limpa.
Mantenha imports, tipos TypeScript e lógica de negócio.

IMPLEMENTAÇÃO:
${impl.content}`,
    'COMPRESS-MINIMAX',
    null,
    null,
    onProgress
  )
  timings.compress_ms = Date.now() - t3
  models.compressor = compressed.modelUsed

  // Stage 4 — DeepSeek V4 Flash revisa (mais rápido que V3)
  emit(onProgress, 'STAGE 4/4', 'info', 'Revisão final com DeepSeek V4 Flash...')
  const t4 = Date.now()
  const reviewed = await callModel(MODELS.flash,
    `${LANGUAGE_RULES}
Revise esta implementação:

${compressed.content}

Verifique: bugs, TypeScript errors, edge cases, lógica de negócio.
Corrija problemas encontrados e retorne a versão final pronta para uso.`,
    'REVIEW-FLASH',
    null,
    null,
    onProgress
  )
  timings.review_ms = Date.now() - t4
  models.reviewer = reviewed.modelUsed

  const totalMs = Object.values(timings).reduce((a, b) => a + b, 0)
  return { finalContent: reviewed.content, route: 'complex', premiumActivated: false, models, timings, totalMs }
}

// ═══════════════════════════════════════════════════════
// ROTA PREMIUM — +DeepSeek R1 → fallback Claude Sonnet
// ═══════════════════════════════════════════════════════
async function routePremium(prompt, context, visionContext = '', onProgress = null) {
  emit(onProgress, 'ROUTER', 'route', 'Rota PREMIUM → Flash → Flash → Minimax → V3 → R1')

  const complex = await routeComplex(prompt, context, visionContext, onProgress)

  // Stage 5 — DeepSeek R1 enterprise (fallback: Claude Sonnet)
  emit(onProgress, 'STAGE 5/5', 'info', 'Revisão enterprise com DeepSeek R1...')
  const t5 = Date.now()
  const enterprise = await callModel(
    MODELS.r1,
    `${LANGUAGE_RULES}
Faça uma revisão enterprise desta implementação:

${complex.finalContent}

Foque em: segurança, autenticação, multi-tenant, race conditions, escalabilidade.
Retorne a versão final refinada e production-ready.`,
    'ENTERPRISE-R1',
    null,
    MODELS.sonnet,
    onProgress
  )

  return {
    finalContent: enterprise.content,
    route: 'premium',
    premiumActivated: true,
    models: { ...complex.models, enterprise: enterprise.modelUsed },
    timings: { ...complex.timings, enterprise_ms: Date.now() - t5 },
    totalMs: complex.totalMs + (Date.now() - t5),
  }
}

// ═══════════════════════════════════════════════════════
// ORQUESTRADOR PRINCIPAL
// onProgress = função chamada a cada etapa (para SSE/streaming)
// ═══════════════════════════════════════════════════════
async function runPipeline(prompt, context, imageBase64 = null, onProgress = null) {
  const totalStart = Date.now()

  emit(onProgress, 'AI-CORE', 'info', '═══ AI-CORE ORQUESTRADOR v4.0 iniciado ═══')

  // 1. Visão
  let visionContext = ''
  if (hasImage(prompt, imageBase64) && imageBase64) {
    visionContext = await analyzeImage(imageBase64, onProgress)
    emit(onProgress, 'VISION', 'done', `Contexto visual extraído: ${visionContext.length} chars`)
  }

  // 2. Classifica
  const complexity = classifyTask(prompt)
  emit(onProgress, 'CLASSIFIER', 'info', `Rota detectada: ${complexity.toUpperCase()}`)

  // 3. Roteia
  let result
  if (complexity === 'simple') {
    result = await routeSimple(
      prompt + (visionContext ? `\n\nCONTEXTO VISUAL:\n${visionContext}` : ''),
      context,
      onProgress
    )
  } else if (complexity === 'premium') {
    result = await routePremium(prompt, context, visionContext, onProgress)
  } else {
    result = await routeComplex(prompt, context, visionContext, onProgress)
  }

  result.totalMs = Date.now() - totalStart
  result.visionUsed = !!visionContext

  emit(onProgress, 'DONE', 'done', `Rota: ${result.route} | Total: ${result.totalMs}ms | Premium: ${result.premiumActivated}`)
  return result
}

module.exports = { runPipeline, isPremiumPrompt: (p) => classifyTask(p) === 'premium' }