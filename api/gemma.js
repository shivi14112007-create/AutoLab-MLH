// Vercel serverless function: POST /api/gemma
// Env vars (Vercel dashboard): GEMMA_API_KEY, GEMMA_MODEL

const RULES =
  'You are LabAssistant, a lab tutor for students. Use ONLY the context given. ' +
  'Do not invent numbers or do calculations; use the numbers provided. ' +
  'If the context is not enough, say so. Use simple language, max 4 short sentences.';

const HINT_LEVELS = {
  0: 'Ask ONE guiding question. Do not reveal the answer.',
  1: 'Tell which stage or setting to re-check. Do not reveal the cause.',
  2: 'Name the type of problem, but not the exact fix.',
  3: 'Reveal the cause and the fix, and explain why.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const apiKey = process.env.GEMMA_API_KEY;
  const model = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMMA_API_KEY not set' });
  }

  const { mode = 'explain', context = '', question = '', level = 0, lang = 'English' } = req.body || {};
  const task =
    mode === 'hint'
      ? HINT_LEVELS[level] || HINT_LEVELS[0]
      : 'Explain the context in simple words for a student.';

  const prompt =
    `${RULES}\nReply in ${lang}.\nTask: ${task}\n\n` +
    `CONTEXT:\n${context}\n\nSTUDENT QUESTION:\n${question || '(none)'}`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      }
    );
    if (!r.ok) return res.status(502).json({ error: 'Gemma unavailable' });
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(502).json({ error: 'Empty response' });
    return res.status(200).json({ text });
  } catch {
    return res.status(502).json({ error: 'Gemma unavailable' });
  }
}
