import { api } from './api';
import { getDeletionIdentity, type SocialProvider } from './socialAuth';

export interface DeletionOptions {
  has_password: boolean;
  providers: SocialProvider[];
  grace_days: number;
}

export type DeletionProof = { password: string } | { provider: SocialProvider };

export async function requestAccountDeletion(proof: DeletionProof): Promise<string> {
  const data = 'provider' in proof
    ? { provider: proof.provider, id_token: await getDeletionIdentity(proof.provider) }
    : proof;
  const response = await api.delete('/api/users/delete/', { data });
  if (response.status !== 202 || response.data?.status !== 'pending_deletion'
      || typeof response.data?.delete_after !== 'string') {
    throw new Error('Deletion was not confirmed. Please try again.');
  }
  return response.data.delete_after;
}
