import { request } from './realtime';

// Where a user's permission level comes from: set by an admin ("db"), the
// owlchirp feature flag ("flag"), or always admin in the server ("hardcoded").
export type PermissionSource = 'db' | 'flag' | 'hardcoded';

export type ManagedUser = { username: string; level: number; source: PermissionSource };

export function listUsers(): Promise<ManagedUser[]> {
  return request<ManagedUser[]>('users.list');
}

export function setPermission(username: string, level: number): Promise<ManagedUser> {
  return request<ManagedUser>('users.setPermission', { username, level });
}

// Removes the admin-set level so the feature flag decides again.
export function resetPermission(username: string): Promise<ManagedUser> {
  return request<ManagedUser>('users.resetPermission', { username });
}
