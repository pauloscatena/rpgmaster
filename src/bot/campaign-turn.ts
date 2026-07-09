import type { Message, TextChannel } from 'discord.js';
import type { Pool } from 'pg';
import type { Campaign } from '../db/campaigns-repo';
import { updateRecentExchanges } from '../db/campaigns-repo';
import { getCharactersByCampaign, type StoredCharacter } from '../db/characters-repo';
import { getCombatState } from '../db/combat-repo';
import type { LlmProvider } from '../llm/provider';
import { fazerTesteTool, consultarFichaTool, type ToolDefinition } from '../llm/tools';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../llm/combat-tools';
import { masterToolsForCampaign } from '../llm/master-grant-tools';
import { buildSystemPrompt, type CampaignTurnMode, type PerceptionPromptContext } from '../llm/context';
import { sanitizeMasterReply } from '../llm/sanitize-reply';
import { appendExchange } from '../llm/short-term-memory';
import { maybeRunReflection } from '../llm/narrative-memory';
import { turnoAtual } from '../rules-engine';

export const PERCEPTION_PLAYER_MESSAGE = '[O jogador concentra a percepção na cena]';

const THINKING_STATUS_LINES = [
  '_🎲 pensando…_',
  '_🔮 consultando runas…_',
  '_⚗️ hipercarbonizando…_',
  '_🌀 rolando destino…_',
  '_🐉 barganhando com os deuses…_',
  '_📜 desembaralhando a lore…_',
  '_🎯 calibrando o d20…_',
  '_✨ invocando plot twist…_',
  '_🎭 sincronizando o biombo…_',
  '_📖 decifrando o grimório…_',
  '_🔥 negociando com dragões…_',
  '_🗣️ aquecendo o NPC…_',
] as const;

function pickThinkingStatus(previous?: string): string {
  const options =
    previous !== undefined
      ? THINKING_STATUS_LINES.filter((line) => line !== previous)
      : THINKING_STATUS_LINES;
  return options[Math.floor(Math.random() * options.length)] ?? THINKING_STATUS_LINES[0];
}

type PresenceChannel = Pick<TextChannel, 'sendTyping' | 'send'>;

export type CampaignTurnResult =
  | { ok: true; narration: string }
  | { ok: false; userMessage: string };

/**
 * Roda um turno narrativo do mestre numa campanha ativa (mensagem ou slash).
 * Retorna erro amigável se não for a vez do personagem em combate.
 */
export async function runActiveCampaignTurn(params: {
  pool: Pool;
  llmProvider: LlmProvider;
  campaign: Campaign;
  character: StoredCharacter;
  playerMessage: string;
  mode?: CampaignTurnMode;
  perceptionCheck?: PerceptionPromptContext;
  channel: PresenceChannel | Message['channel'];
  reply: (text: string) => Promise<void>;
}): Promise<CampaignTurnResult> {
  const { pool, llmProvider, campaign, character, playerMessage, reply } = params;
  const mode = params.mode ?? 'normal';

  const party = await getCharactersByCampaign(pool, campaign.id);
  const combatState = await getCombatState(pool, campaign.id);
  let tools: ToolDefinition[] = [
    fazerTesteTool,
    consultarFichaTool,
    ...masterToolsForCampaign({
      economyEnabled: campaign.economyEnabled,
      config: campaign.rulesetConfig,
    }),
  ];
  let combatContext: { pool: Pool; campaignId: string } | undefined;

  if (combatState) {
    const currentCombatant = turnoAtual({ order: combatState.order, currentIndex: combatState.currentIndex });
    const actingCombatant = combatState.combatants.find((c) => c.characterId === character.id);
    if (!actingCombatant || actingCombatant.id !== currentCombatant.id) {
      return { ok: false, userMessage: `Ainda não é sua vez. É a vez de **${currentCombatant.name}**.` };
    }
    tools = [...tools, resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool];
    combatContext = { pool, campaignId: campaign.id };
  }

  const systemPrompt = buildSystemPrompt({
    campaignName: campaign.name,
    lore: campaign.lore,
    ritmoAtual: campaign.ritmoAtual,
    proximoMarco: campaign.proximoMarco,
    fatosCruciais: campaign.fatosCruciais,
    recentExchanges: campaign.recentExchanges,
    rulesetName: campaign.rulesetConfig.name,
    inCombat: Boolean(combatState),
    actingCharacterName: character.sheet.name,
    actingCharacterShortName: character.sheet.shortName,
    partyCharacters: party.map((c) => ({ name: c.sheet.name, shortName: c.sheet.shortName })),
    economyEnabled: campaign.economyEnabled,
    currencyNames: campaign.currencyNames,
    mode,
    perceptionCheck: params.perceptionCheck,
  });

  let typingInterval: ReturnType<typeof setInterval> | undefined;
  let statusMessage: Message | undefined;
  let lastStatus: string | undefined;

  const cleanupPresence = async () => {
    if (typingInterval !== undefined) {
      clearInterval(typingInterval);
      typingInterval = undefined;
    }
    if (statusMessage) {
      const toDelete = statusMessage;
      statusMessage = undefined;
      await toDelete.delete().catch(() => {});
    }
  };

  try {
    const channel = params.channel;
    if (channel && 'sendTyping' in channel) {
      const refreshPresence = () => {
        void channel.sendTyping().catch(() => {});
        if (statusMessage) {
          const next = pickThinkingStatus(lastStatus);
          lastStatus = next;
          void statusMessage.edit(next).catch(() => {});
        }
      };

      void channel.sendTyping().catch(() => {});
      if ('send' in channel) {
        lastStatus = pickThinkingStatus();
        try {
          statusMessage = await channel.send(lastStatus);
        } catch {
          statusMessage = undefined;
        }
      }
      typingInterval = setInterval(refreshPresence, 8_000);
    }

    const result = await llmProvider.runTurn(systemPrompt, playerMessage, tools, {
      config: campaign.rulesetConfig,
      actingCharacter: character,
      rng: Math.random,
      pool,
      combat: combatContext,
      campaignMemory: {
        pool,
        campaignId: campaign.id,
        campaignMessageCount: campaign.campaignMessageCount,
        masterGrantLog: campaign.masterGrantLog,
        economyEnabled: campaign.economyEnabled,
        currencyNames: campaign.currencyNames,
      },
    });

    await cleanupPresence();
    const narration = sanitizeMasterReply(result.narration);
    await reply(narration);

    const updatedExchanges = appendExchange(campaign.recentExchanges, {
      characterName: character.sheet.name,
      playerMessage,
      narration,
    });
    const updatedCampaign = await updateRecentExchanges(pool, campaign.id, updatedExchanges);

    await maybeRunReflection({
      pool,
      campaignId: campaign.id,
      campaign: updatedCampaign,
      llmProvider,
      config: campaign.rulesetConfig,
      actingCharacter: character,
      rng: Math.random,
    });

    return { ok: true, narration };
  } catch (err) {
    console.error('Erro ao processar turno do LLM:', err);
    try {
      await cleanupPresence();
      await reply(
        'O mestre hesita por um instante, como se a névoa da trama o tivesse envolvido... Tente de novo em breve.'
      );
    } catch (replyErr) {
      console.error('Erro ao enviar mensagem de fallback:', replyErr);
    }
    return { ok: false, userMessage: 'turno_falhou' };
  } finally {
    await cleanupPresence();
  }
}
