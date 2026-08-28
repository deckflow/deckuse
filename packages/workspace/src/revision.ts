import { randomUUID } from 'node:crypto';

export const revision = () => `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
