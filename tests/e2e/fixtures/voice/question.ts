/** The words of the recorded question both voice checks upload: "¿Qué citas tengo hoy?". */
const QUESTION_WORDS = ['que', 'citas', 'tengo', 'hoy']

/**
 * True when a transcription recovered the fixture question. Deepgram keyword
 * boosts (the business's client first names) can replace a word — in the E2E
 * business "citas" came back as "E2E" — so two of the four words are enough.
 */
export function transcribedQuestion(transcription: string | undefined): boolean {
  const words = (transcription ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  return QUESTION_WORDS.filter(w => words.includes(w)).length >= 2
}
