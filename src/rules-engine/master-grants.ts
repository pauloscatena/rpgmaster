export const MAX_XP_PER_MASTER_GRANT = 5;
export const MASTER_GRANT_COOLDOWN_MESSAGES = 30;
export const MAX_MASTER_GRANTS_PER_CHARACTER = 10;

export function canMasterGrant(params: {
  evolutionEnabled: boolean;
  campaignMessageCount: number;
  lastMasterGrantAtCampaignMessages: number | null;
  priorGrantCountForCharacter: number;
}): { ok: true } | { ok: false; error: string } {
  if (!params.evolutionEnabled) {
    return { ok: false, error: 'Evolução desligada nesta campanha.' };
  }
  if (params.priorGrantCountForCharacter >= MAX_MASTER_GRANTS_PER_CHARACTER) {
    return { ok: false, error: `Limite de concessões do Mestre atingido (${MAX_MASTER_GRANTS_PER_CHARACTER}).` };
  }
  if (params.lastMasterGrantAtCampaignMessages != null) {
    const elapsed = params.campaignMessageCount - params.lastMasterGrantAtCampaignMessages;
    if (elapsed < MASTER_GRANT_COOLDOWN_MESSAGES) {
      return { ok: false, error: 'Concessão em cooldown.' };
    }
  }
  return { ok: true };
}

export function validateMasterXpAmount(amount: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_XP_PER_MASTER_GRANT) {
    return { ok: false, error: `XP máximo por concessão: ${MAX_XP_PER_MASTER_GRANT}.` };
  }
  return { ok: true };
}

export function validateGrantReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof reason !== 'string' || reason.trim().length < 8) {
    return { ok: false, error: 'Motivo da concessão muito curto (mín. 8 caracteres).' };
  }
  return { ok: true, reason: reason.trim() };
}
