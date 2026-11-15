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

  const VALID_TAGS = ['erotic', 'violence', 'suicide', 'drugs', 'trauma', 'abuse']

  const prompt = [
    'You are a content moderation assistant for a creative writing platform.',
    'Analyze the following text and return ONLY a JSON array of applicable content warning tags.',
    'Valid tags: erotic, violence, suicide, drugs, trauma, abuse.',
    'Return an empty array [] if none apply.',
    'Rules:',
    '- erotic: explicit sexual content',
    '- violence: graphic violence or gore',
    '- suicide: suicide, self-harm, eating disorders as lived experience',
    '- drugs: explicit drug or substance use',
    '- trauma: abuse, war, intense loss described in detail',
    '- abuse: physical, emotional or sexual abuse',
    'Return ONLY valid JSON like ["violence"] or []. No explanation, no markdown, no prose.',
    '',
    'Text to analyze:',
    text.slice(0, 3000),
  ].join('\n')

  const result = await c.env.AI.run(
    '@cf/meta/llama-3.2-3b-instruct' as unknown as keyof AiModels,
    {
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: 64,
    }
  ) as { response?: string }

  let warnings: string[] = []
  try {
    const raw = (result.response ?? '').trim()
    // Extrai o array JSON da resposta mesmo que venha com texto extra
    const match = raw.match(/\[.*?\]/s)
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown[]
      warnings = parsed.filter((t): t is string => VALID_TAGS.includes(t as string))
    }
  } catch { /* retorna [] em caso de parse error */ }

  return c.json({ warnings })
})
