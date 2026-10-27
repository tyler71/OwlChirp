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

export async function apiHeaders(): Promise<HeadersInit> {
  return {
    'Content-Type': 'application/json;charset=UTF-8',
    'X-Api-Key': await apiKey(),
  };
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { ...(await apiHeaders()), ...(init.headers ?? {}) },
  });
}
