import { describe, it, expect } from 'vitest';
import {
  canMasterGrant,
  validateMasterXpAmount,
  MAX_XP_PER_MASTER_GRANT,
  MASTER_GRANT_COOLDOWN_MESSAGES,
} from '../../src/rules-engine/master-grants';

describe('master-grants', () => {
  it('aceita amount 1..5', () => {
    expect(validateMasterXpAmount(5).ok).toBe(true);
    expect(validateMasterXpAmount(6).ok).toBe(false);
    expect(MAX_XP_PER_MASTER_GRANT).toBe(5);
  });

  it('aplica cooldown de 30 mensagens', () => {
    expect(MASTER_GRANT_COOLDOWN_MESSAGES).toBe(30);
    const blocked = canMasterGrant({
      evolutionEnabled: true,
      campaignMessageCount: 40,
      lastMasterGrantAtCampaignMessages: 20,
      priorGrantCountForCharacter: 0,
    });
    expect(blocked.ok).toBe(false);
    const ok = canMasterGrant({
      evolutionEnabled: true,
      campaignMessageCount: 50,
      lastMasterGrantAtCampaignMessages: 20,
      priorGrantCountForCharacter: 0,
    });
    expect(ok.ok).toBe(true);
  });

  it('rejeita evolution off', () => {
    expect(
      canMasterGrant({
        evolutionEnabled: false,
        campaignMessageCount: 0,
        lastMasterGrantAtCampaignMessages: null,
        priorGrantCountForCharacter: 0,
      }).ok
    ).toBe(false);
  });
});
