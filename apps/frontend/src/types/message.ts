export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to?: string; // set on outbound messages — the customer's wa_id
  text: string;
  timestamp: string;
}
