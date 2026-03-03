export type IntegrationStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'PENDING_TOKEN'
  | 'ACTIVE'
  | 'ERROR'
  | 'MIGRATING';

export interface IntegrationDoc {
  businessId: string;
  status: IntegrationStatus;
  metaData: Record<string, string>;
  updatedAt: string;
}
