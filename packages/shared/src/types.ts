export type UserStatus = 'active' | 'grace' | 'suspended';
export type AccountRequestStatus = 'pending' | 'approved' | 'rejected';
export type ServerStatus = 'installing' | 'active' | 'suspended' | 'expired';
export const BRANDING = {
  panel: 'LunixPanel',
  vendor: 'QyroCloud',
  studio: 'Clover Studios',
} as const;
