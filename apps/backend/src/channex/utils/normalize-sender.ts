const HOST_SENDER_VALUES = new Set([
  'host',
  'property_manager',
  'host_user',
  'owner',
  'property',
]);

export function normalizeSender(raw: string): 'host' | 'guest' {
  return HOST_SENDER_VALUES.has(raw.toLowerCase().trim()) ? 'host' : 'guest';
}
