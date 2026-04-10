export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to?: string; // set on outbound messages — the customer's wa_id
  text: string;
  timestamp: string;
  // ── Instagram-specific fields (present when channel === 'META_INSTAGRAM') ──
  channel?: string;
  interactionType?: 'DIRECT_MESSAGE' | 'STORY_MENTION' | 'COMMENT';
  /** Present on COMMENT messages — the Meta comment ID (idempotency key) */
  commentId?: string;
  /** Present on COMMENT messages — the parent Post or Reel ID */
  mediaId?: string;
}
