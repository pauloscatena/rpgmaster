/**
 * Limite de palavra Unicode-aware (letras/números PT-BR).
 * Evita substring: "documento" não dispara por "cu".
 */
const WB_LEFT = '(?<![\\p{L}\\p{N}_])';
const WB_RIGHT = '(?![\\p{L}\\p{N}_])';

function wordRe(inner: string): RegExp {
  return new RegExp(`${WB_LEFT}(?:${inner})${WB_RIGHT}`, 'iu');
}

/** Palavrões comuns PT-BR (e máscaras leves com * / @). Só palavra inteira. */
const PROFANITY_PATTERNS: RegExp[] = [
  wordRe('p+o*[\\*@]*r+r+[a\\*@]*'),
  wordRe('c+a*[\\*@]*r+a*[\\*@]*l+h+[oõ\\*@]*s?'),
  wordRe('m+e*[\\*@]*r+d+[a\\*@]*'),
  wordRe('p+u*[\\*@]*t+[a\\*@]*'),
  wordRe('f+o+d+[ae]+(?:r|ndo|u|i)?'),
  wordRe('c+u+'),
  wordRe('b+o+s+t+a+'),
  wordRe('c+a+c+[ae]t[ea]'),
  wordRe('f+d+p+'),
  wordRe('f\\s*d\\s*p'),
  wordRe('fi+l+h+[oa]\\s+d+[ae]\\s+p+u+t+a+'),
  wordRe('c+a+g+[ao]+(?:r|ndo|u)?'),
  wordRe('d+e+s+g+r+a[cç]+[a\\*@]*'),
  wordRe('v+a+i+\\s+s+[eé]+\\s+f+o+d+[ae]+r?'),
  wordRe('v+a+i+\\s+t+o+m+a+r+\\s+n+o+\\s+c+u+'),
];

const PROFANITY_RETORTS = [
  'Você beija a sua mãe com essa boca?',
  'A mesa inteira fingiu que não ouviu. Inclusive eu.',
  'Que vocabulário rico. Os bardos devem estar orgulhosos.',
  'Anotado na ficha, sob "carisma": em revisão.',
  'Legal. Agora diga isso de novo olhando nos olhos do clérigo.',
  'Os dados pediram um momento… de segunda mão.',
  'Impressionante. Até o goblin pediu para você baixar o tom.',
  'Se eloquência fosse XP, você acabou de falhar o teste.',
  'A taverna abriu uma janela. Por educação, não por brisa.',
  'O dragão ouviu e fingiu ser surdo. Por solidariedade.',
  'Isso vai na ata da guilda. Com aspas. E um suspiro.',
  'Seu personagem ganhou a condição *constrangido*. Dura 1 cena.',
  'Os ancestrais pedem um momento de silêncio. E um enxágue.',
  'Que entrada. O bardo já está compondo a balada… satírica.',
  'Eu ia narrar algo épico, mas você matou o clima com estilo.',
] as const;

/**
 * Detecta palavrões comuns em PT-BR (e máscaras leves com *).
 * Só conta palavra inteira — substring em "documento"/"escultura"/"cubo" não dispara.
 */
export function detectProfanity(text: string): boolean {
  const normalized = text.normalize('NFC');
  return PROFANITY_PATTERNS.some((re) => re.test(normalized));
}

/** Frase sarcástica aleatória do mestre (constranger de leve). */
export function randomProfanityRetort(rng: () => number = Math.random): string {
  const index = Math.floor(rng() * PROFANITY_RETORTS.length);
  return PROFANITY_RETORTS[index] ?? PROFANITY_RETORTS[0];
}

export { PROFANITY_RETORTS };
