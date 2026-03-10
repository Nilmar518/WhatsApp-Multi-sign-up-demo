export enum MatchType {
  EXACT = 'EXACT',
  CONTAINS = 'CONTAINS',
}

export interface AutoReply {
  id: string;
  triggerWord: string;
  matchType: MatchType;
  collectionTitle: string;
  retailerIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
