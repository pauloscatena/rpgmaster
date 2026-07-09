import type { RecentExchange } from '../db/campaigns-repo';

const PC_ALIAS_AFTER =
  /(?=\s+(?:se|decide|decidiu|fica|ficou|examina|examinou|pega|pegou|mantém|mantem|manteve|avança|avanca|avançou|observa|observou|aproxima|aproximou|encontra|encontrou|lê|le|leu|coloca|colocou|procura|procurou|inspeciona|inspecionou|aguarda|aguardou|caminha|caminhou|sente|sentiu|pode|pôde|vê|ve|viu|olha|olhou|descobre|descobriu|reconhece|reconheceu|espera|esperou|continua|continuou|formula|formulou|reage|reagiu)\b)/iu;

/** Nomes próprios usados como sujeito do PC (ex.: "Ronaldo decide") que não são o nome canônico. */
export function findLikelyPcAliases(text: string, canonical: Set<string>): string[] {
  const found = new Set<string>();
  const re = /\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,})\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!;
    if (canonical.has(name.toLowerCase())) continue;
    const after = text.slice(m.index + name.length);
    if (PC_ALIAS_AFTER.test(after)) {
      found.add(name);
    }
  }
  return [...found];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyAliases(text: string, aliases: string[], replacement: string): string {
  let out = text;
  for (const alias of aliases) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'g'), replacement);
  }
  return out;
}

export function rewritePcAliasesInText(
  text: string,
  actingName: string,
  actingShortName: string
): string {
  const canonical = new Set([actingName.toLowerCase(), actingShortName.toLowerCase()]);
  const aliases = findLikelyPcAliases(text, canonical);
  return applyAliases(text, aliases, actingShortName);
}

/** Alinha trocas/fatos ao nome da ficha quando o histórico ainda carrega alias inventado (ex.: Ronaldo). */
export function alignMemoryToActingCharacter(params: {
  recentExchanges: RecentExchange[];
  fatosCruciais: string[];
  actingCharacterName: string;
  actingCharacterShortName: string;
}): { recentExchanges: RecentExchange[]; fatosCruciais: string[] } {
  const { actingCharacterName: name, actingCharacterShortName: shortName } = params;
  const nameLc = name.toLowerCase();
  const shortLc = shortName.toLowerCase();
  const canonical = new Set([nameLc, shortLc]);

  const aliases = new Set<string>();
  for (const e of params.recentExchanges) {
    const isActing = e.characterName.toLowerCase() === nameLc || e.characterName.toLowerCase() === shortLc;
    if (!isActing) continue;
    for (const a of findLikelyPcAliases(e.narration, canonical)) {
      aliases.add(a);
    }
  }
  // Também varre fatos com heurística de verbo (passado/presente)
  for (const f of params.fatosCruciais) {
    for (const a of findLikelyPcAliases(f, canonical)) {
      aliases.add(a);
    }
  }

  const aliasList = [...aliases];

  const recentExchanges = params.recentExchanges.map((e) => {
    const isActing = e.characterName.toLowerCase() === nameLc || e.characterName.toLowerCase() === shortLc;
    if (!isActing) return e;
    return {
      ...e,
      characterName: name,
      narration: applyAliases(e.narration, aliasList, shortName),
    };
  });

  const fatosCruciais = params.fatosCruciais.map((f) => applyAliases(f, aliasList, shortName));

  return { recentExchanges, fatosCruciais };
}
