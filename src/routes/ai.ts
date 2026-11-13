/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; AI: Ai; JWT_SECRET: string }
type Variables = { authId: string }

export const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type AICommand = 'complete' | 'suggest-rhyme' | 'rewrite' | 'suggest-title' | 'suggest-slug'
type AILanguage = 'pt' | 'en' | 'es' | 'it'

function languageInstruction(language?: AILanguage): string {
  if (language === 'pt') return 'Respond in Brazilian Portuguese (Português do Brasil).'
  if (language === 'en') return 'Respond in English.'
  if (language === 'es') return 'Respond in Spanish (Español).'
  if (language === 'it') return 'Respond in Italian (Italiano).'
  return 'Match the exact language(s) of the original text, including any intentional code-switching.'
}

function buildPrompt(command: AICommand, context: string, selection?: string, language?: AILanguage): string {
  const lang = languageInstruction(language)

  switch (command) {
    case 'complete':
      return [
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
    '@cf/meta/llama-3.2-3b-instruct' as BaseAiTextGenerationModels,
    {
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 256,
    }
  )

  return new Response(stream as ReadableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})
