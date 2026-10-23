import type { Request, Response } from './protocol';

// Thin promise wrapper around the geometry worker.
const worker = new Worker(new URL('./geo.worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();

worker.onmessage = (ev: MessageEvent<{ id: number; res: Response }>) => {
  pending.get(ev.data.id)?.(ev.data.res);
  pending.delete(ev.data.id);
};

export function call<T extends Response['type']>(req: Request, transfer: Transferable[] = []):
  Promise<Extract<Response, { type: T }> | Extract<Response, { type: 'error' }>> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as (r: Response) => void);
    worker.postMessage({ id, req }, transfer);
  });
}
