import { getAgentId, sha256Hex } from './helpers';
import { $agent } from './stores';

// X-Api-Key: sha256("{unix timestamp of current UTC hour}{agentId}{username}")
export async function apiKey(agent: connect.Agent | null = $agent.get()): Promise<string> {
  if (!agent) throw new Error('CCP agent not ready');

  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  const timestamp = Math.floor(date.getTime() / 1000);

  const agentId = getAgentId(agent) ?? '';
  const username = agent.getConfiguration().username;

  return sha256Hex(`${timestamp}${agentId}${username}`);
}
