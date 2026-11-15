/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; AI: Ai; JWT_SECRET: string }
type Variables = { authId: string }

export const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type AICommand = 'complete' | 'suggest-rhyme' | 'rewrite' | 'suggest-title' | 'suggest-slug'
type AILanguage = 'pt' | 'en' | 'es' | 'it'

function languageInstruction(language?: AILanguage): string {
  if (language === 'pt') return 'IMPORTANT: You MUST respond ONLY in Brazilian Portuguese (Português do Brasil). Do not use any other language.'
  if (language === 'en') return 'IMPORTANT: You MUST respond ONLY in English. Do not use any other language.'
  if (language === 'es') return 'IMPORTANT: You MUST respond ONLY in Spanish (Español). Do not use any other language.'
  if (language === 'it') return 'IMPORTANT: You MUST respond ONLY in Italian (Italiano). Do not use any other language.'
  return 'Match the exact language(s) of the original text, including any intentional code-switching.'
}

function buildPrompt(command: AICommand, context: string, selection?: string, language?: AILanguage): string {
  const lang = languageInstruction(language)
  const langPrefix = language ? `[LANGUAGE: ${lang}]\n\n` : ''

  switch (command) {
    case 'complete':
      return [
        langPrefix,
        'You are a creative writing assistant. Continue the following text naturally, ',
        'matching the author\'s style and tone. ',
        lang, ' ',
        'Write only the continuation — no preamble, no explanation, no quotes. ',
        'Keep it concise (1–3 sentences or lines).\n\n',
        'Text so far:\n',
        context,
      ].join('')

    case 'rewrite':
      return [
        langPrefix,
        'You are a creative writing assistant. Rewrite the following excerpt, ',
        'preserving the original meaning but improving clarity, flow, or style. ',
        lang, ' ',
        'Return only the rewritten text — no preamble, no explanation, no quotes.\n\n',
        'Excerpt to rewrite:\n',
        selection ?? context,
      ].join('')

    case 'suggest-rhyme':
      return [
        'You are a poetry assistant. Suggest 5 words or short phrases that rhyme with ',
        'the last word or syllable of the following text. ',
        'Match the language of the original text. ',
        'Return only the rhymes, one per line, no numbering, no explanation.\n\n',
        'Text:\n',
        selection ?? context,
      ].join('')

    case 'suggest-title':
      return [
        'You are a creative writing assistant. Suggest a compelling, concise title ',
        'for the following text. Match the language of the original text. ',
        'Return only the title — no quotes, no explanation, no alternatives.\n\n',
        'Text:\n',
        context,
      ].join('')

    case 'suggest-slug':
      return [
        'You are a creative writing assistant. Generate a URL-friendly slug for the ',
        'following text title or content. Use lowercase letters, numbers, and hyphens only. ',
        'No accents, no special characters, no spaces. Keep it short (3–6 words). ',
        'Return only the slug — no explanation.\n\n',
        'Text:\n',
        context,
      ].join('')
  }
}

// POST /ai — run an AI command (authenticated, streaming)
ai.post('/', authMiddleware, async (c) => {
  const body = await c.req.json<{
    command: AICommand
    context: string
    selection?: string
    language?: AILanguage
  }>()

  const { command, context, selection, language } = body

  if (!command || !context) {
    return c.json({ error: 'command and context are required' }, 400)
  }

  const validCommands: AICommand[] = [
    'complete', 'suggest-rhyme', 'rewrite', 'suggest-title', 'suggest-slug',
  ]
  if (!validCommands.includes(command)) {
    return c.json({ error: 'Invalid command' }, 400)
  }

  const prompt = buildPrompt(command, context.slice(0, 4000), selection, language)

  const stream = await c.env.AI.run(
    '@cf/meta/llama-3.2-3b-instruct' as unknown as keyof AiModels,
    {
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 256,
    }
  )

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// POST /ai/classify-warnings — classifica avisos de conteúdo (não streaming)
ai.post('/classify-warnings', authMiddleware, async (c) => {
  const body = await c.req.json<{ text: string }>()
  const { text } = body

  if (!text) return c.json({ error: 'text is required' }, 400)

  // Pré-filtro de palavras-chave para tags sensíveis (determinístico, não depende do modelo)
  const KEYWORD_RULES: Record<string, string[]> = {
    erotic: ['bdsm', 'sexo explícito', 'pornô', 'pornografia', 'cena de nudez', 'nudez corporal', 'fetiche sexual', 'conteúdo adulto', 'explicit sex', 'sexual act', 'nude scene'],
    violence: ['gore', 'sangue jorrando', 'decapitação', 'esquartejamento', 'tortura explícita'],
    suicide: ['cometeu suicídio', 'se suicidou', 'tentou se matar', 'se enforc', 'tomou veneno para morrer', 'se jogou do', 'suicídio como ato'],
    drugs: ['cheirou cocaína', 'usou heroína', 'fumou crack', 'injetou droga', 'overdose de'],
    abuse: ['estuprou', 'abusou sexualmente', 'bateu até sangrar', 'abuso sexual de menor'],
  }

  const textLower = text.toLowerCase()
  const keywordTags = new Set<string>()
  for (const [tag, keywords] of Object.entries(KEYWORD_RULES)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      keywordTags.add(tag)
    }
  }

  const VALID_TAGS = [
    'erotic', 'violence', 'suicide', 'drugs', 'trauma', 'abuse',
    'love', 'relationships', 'nature', 'religion', 'politics',
    'humor', 'family', 'loss', 'identity', 'fantasy', 'mystery', 'social', 'spirituality',
  ]

  const userPrompt = [
    'You are a content classifier for a creative writing platform (poems, songs, stories).',
    'Your job: decide which tags apply so readers can choose what to read.',
    '',
    'GUIDING PRINCIPLE for sensitive tags:',
    'Ask yourself: "Would the average reader feel uncomfortable or disturbed by this passage?"',
    'The test is NOT whether the content is literal or metaphorical.',
    'A metaphor can still create an explicit, disturbing image. Example:',
    '  BAD (triggers erotic): "felt as happy as having genitals on her face" — graphic image even as metaphor',
    '  OK (no tag): "the nakedness of my feelings" — no disturbing image, just poetic language',
    '  BAD (triggers suicide): "she took all the pills and waited to die" — explicit act even in fiction',
    '  OK (no tag): "I cauterize my wounds with love" — metaphor for healing, no disturbing image',
    '',
    'SENSITIVE TAGS — apply if the image/act would disturb an average reader:',
    '  erotic = sexual imagery, nudity, or bdsm that creates an explicit visual (literal OR metaphorical)',
    '  violence = graphic physical violence, gore, or brutal acts',
    '  suicide = suicidal acts, self-harm described in a way that feels real or instructional',
    '  drugs = explicit drug use scenes',
    '  trauma = graphic depiction of traumatic events (war, assault, disaster)',
    '  abuse = physical, emotional or sexual abuse described in a disturbing way',
    '',
    'DESCRIPTIVE TAGS — apply when the theme is clearly present:',
    '  love = romantic love, passion, desire',
    '  relationships = friendship, bonds, human connection',
    '  nature = landscape, animals, environment, seasons',
    '  religion = faith, ritual, prayer, religious themes',
    '  politics = power, social criticism, activism',
    '  humor = comedy, irony, satire',
    '  family = parenting, siblings, ancestry',
    '  loss = grief, mourning, death, absence',
    '  identity = self-discovery, belonging, gender, culture',
    '  fantasy = magic, mythology, supernatural',
    '  mystery = suspense, secrets, the unknown',
    '  social = inequality, society, community',
    '  spirituality = mysticism, inner journey, transcendence',
    '',
    'Rules:',
    '- Use ONLY these exact English tag words, never translate them',
    '- Output ONLY a JSON array, no explanation, no preamble',
    'Examples: ["erotic","love"] or ["loss","nature","spirituality"] or []',
    '',
    'TEXT:',
    text.slice(0, 2000),
  ].join('\n')

  let raw = ''
  let warnings: string[] = []

  try {
    const result = await c.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct-fp8' as unknown as keyof AiModels,
      {
        messages: [{ role: 'user', content: userPrompt }],
        stream: false,
        max_tokens: 150,
      }
    ) as { response?: string }

    // Suporta dois formatos: { response } (Workers AI simples) e chat completion { choices }
    const resp = result as Record<string, unknown>
    if (typeof resp.response === 'string') {
      raw = resp.response.trim()
    } else {
      type Choice = { message?: { content?: string } }
      const choices = resp.choices as Choice[] | undefined
      raw = choices?.[0]?.message?.content?.trim() ?? JSON.stringify(resp)
    }

    // Tentativa 1: extrair array JSON do texto (suporta aspas simples)
    try {
      const normalized = raw.replace(/'/g, '"')
      const match = normalized.match(/\[[\s\S]*?\]/)
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown[]
        warnings = parsed.filter((t): t is string => VALID_TAGS.includes(t as string))
      }
    } catch { /* segue para fallback */ }

    // Tentativa 2: fallback — extrai qualquer tag válida mencionada no texto
    if (warnings.length === 0) {
      warnings = VALID_TAGS.filter(tag => new RegExp(`\\b${tag}\\b`, 'i').test(raw))
    }
  } catch (err) {
    return c.json({ warnings: [], _debug_raw: '', _error: String(err) }, 200)
  }

  // Mescla tags do pré-filtro com as do AI (sem duplicatas)
  const merged = Array.from(new Set([...keywordTags, ...warnings]))
    .filter((t): t is string => VALID_TAGS.includes(t))

  return c.json({ warnings: merged, _debug_raw: raw.slice(0, 300) })
})
