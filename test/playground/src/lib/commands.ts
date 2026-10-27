import type { CommandId } from '../shared/commands';

export const icons: Record<CommandId, string> = {
  get: '↙',
  query: '⌕',
  scan: '▤',
  put: '＋',
  update: '↻',
  delete: '−',
  'batch-get': '⇊',
  'batch-write': '⇈',
  'transact-get': '⇠',
  'transact-write': '⇢',
};
export const groups = ['Read', 'Write', 'Batch', 'Transaction'] as const;
