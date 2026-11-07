import { request } from './realtime';
import type { Feature } from './stores';

// Where a user's features come from: set by an admin ("db"), none set yet
// ("default"), or always admin in the server ("hardcoded").
export type PermissionSource = 'db' | 'default' | 'hardcoded';

export type ManagedUser = { username: string; features: Feature[]; source: PermissionSource };

export function listUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('users.list');
}

export function setFeatures(username: string, features: Feature[]): Promise<ManagedUser> {
  return request<ManagedUser>('users.setFeatures', { username, features });
}

// Removes the admin-set features, leaving the user with Phone and Settings only.
export function resetFeatures(username: string): Promise<ManagedUser> {
  return request<ManagedUser>('users.resetFeatures', { username });
}
