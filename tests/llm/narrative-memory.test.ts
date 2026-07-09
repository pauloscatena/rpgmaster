import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel, type Campaign } from '../../src/db/campaigns-repo';
import { createCharacter, type StoredCharacter } from '../../src/db/characters-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import {
  atualizarEstadoNarrativoTool,
  buildReflectionPrompt,
  maybeRunReflection,
  REFLECTION_INTERVAL,
} from '../../src/llm/narrative-memory';
import type { LlmProvider } from '../../src/llm/provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';

describe('atualizarEstadoNarrativoTool', () => {
  let pool: Pool;
  let campaignId: string;
  let aria: StoredCharacter;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
    aria = await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  function makeCtx(): ToolContext {
    return {
      config: defaultRulesetConfig(),
      actingCharacter: aria,
      rng: () => 0.5,
      narrativeMemory: { pool, campaignId },
    };
  }

  it('persiste ritmo_atual, proximo_marco e fatos_cruciais na campanha', async () => {
    await atualizarEstadoNarrativoTool.execute(
      { ritmo_atual: 'ação', proximo_marco: 'encontrar o goblin', fatos_cruciais: ['o rei está morto'] },
      makeCtx()
    );
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.ritmoAtual).toBe('ação');
    expect(campaign?.proximoMarco).toBe('encontrar o goblin');
    expect(campaign?.fatosCruciais).toEqual(['o rei está morto']);
  });

  it('zera messagesSinceReflection ao persistir', async () => {
    await atualizarEstadoNarrativoTool.execute(
      { ritmo_atual: 'ação', proximo_marco: 'x', fatos_cruciais: [] },
      makeCtx()
    );
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.messagesSinceReflection).toBe(0);
  });

  it('lança erro sem o contexto de memória narrativa', async () => {
    const ctx: ToolContext = { config: defaultRulesetConfig(), actingCharacter: aria, rng: () => 0.5 };
    await expect(
      atualizarEstadoNarrativoTool.execute({ ritmo_atual: 'x', proximo_marco: 'y', fatos_cruciais: [] }, ctx)
    ).rejects.toThrow(/contexto de memória narrativa/);
  });

  it('lança erro quando ritmo_atual não é string', async () => {
    await expect(
      atualizarEstadoNarrativoTool.execute({ ritmo_atual: 42, proximo_marco: 'y', fatos_cruciais: [] }, makeCtx())
    ).rejects.toThrow(/ritmo_atual/);
  });

  it('lança erro quando fatos_cruciais não é uma lista de strings', async () => {
    await expect(
      atualizarEstadoNarrativoTool.execute(
        { ritmo_atual: 'x', proximo_marco: 'y', fatos_cruciais: 'não é lista' },
        makeCtx()
      )
    ).rejects.toThrow(/fatos_cruciais/);
  });
});

describe('buildReflectionPrompt', () => {
  it('inclui o estado atual e as trocas recentes no prompt', () => {
    const { system, user } = buildReflectionPrompt({
      ritmoAtual: 'ação',
      proximoMarco: 'encontrar o goblin',
      fatosCruciais: ['o rei está morto'],
      recentExchanges: [{ characterName: 'Aria', playerMessage: 'eu entro na sala', narration: 'Você entra na sala.' }],
    });
    expect(system).toMatch(/atualizar_estado_narrativo/);
    expect(user).toContain('ação');
    expect(user).toContain('encontrar o goblin');
    expect(user).toContain('o rei está morto');
    expect(user).toContain('eu entro na sala');
  });

  it('usa textos padrão quando o estado ainda está vazio', () => {
    const { user } = buildReflectionPrompt({ ritmoAtual: '', proximoMarco: '', fatosCruciais: [], recentExchanges: [] });
    expect(user).toMatch(/nenhum registrado ainda/);
  });
});

describe('maybeRunReflection', () => {
  let pool: Pool;
  let campaign: Campaign;
  let aria: StoredCharacter;

  beforeEach(async () => {
    pool = createTestPool();
    campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    aria = await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  function makeParams(overrides: { llmProvider: LlmProvider; messagesSinceReflection: number }) {
    return {
      pool,
      campaignId: campaign.id,
      campaign: { ...campaign, messagesSinceReflection: overrides.messagesSinceReflection },
      llmProvider: overrides.llmProvider,
      config: defaultRulesetConfig(),
      actingCharacter: aria,
      rng: () => 0.5,
    };
  }

  it('não chama o provedor quando o contador está abaixo do limiar', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn() };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL - 1 }));
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('chama o provedor e persiste o estado quando o contador atinge o limiar', async () => {
    const llmProvider: LlmProvider = {
      runTurn: vi.fn().mockImplementation(async (_system: string, _user: string, tools: ToolDefinition[], ctx: ToolContext) => {
        await tools[0]!.execute({ ritmo_atual: 'ação', proximo_marco: 'x', fatos_cruciais: ['y'] }, ctx);
        return { narration: '', toolCalls: [] };
      }),
    };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }));
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.ritmoAtual).toBe('ação');
  });

  it('zera o contador mesmo quando o modelo não chama a tool', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn().mockResolvedValue({ narration: 'só narrou', toolCalls: [] }) };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }));
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.messagesSinceReflection).toBe(0);
  });

  it('não propaga erro quando o provedor falha', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(
      maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }))
    ).resolves.toBeUndefined();
  });
});
