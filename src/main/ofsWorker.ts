import { parentPort, workerData } from 'node:worker_threads';
import { OrionFS, type OFSConfig } from '../../ofs';

const engine = new OrionFS(workerData as OFSConfig);
let queue: Promise<void> = Promise.resolve();
parentPort!.on('message', (request: { id: number; method: string; args: unknown[] }) => {
  queue = queue.then(async () => {
    try {
      let result: unknown;
      switch (request.method) {
        case 'ingest': result = await engine.ingestTurn(...request.args as Parameters<OrionFS['ingestTurn']>); break;
        case 'recall': result = await engine.recall(...request.args as Parameters<OrionFS['recall']>); break;
        case 'stats': result = engine.getStats(...request.args as Parameters<OrionFS['getStats']>); break;
        case 'list': result = engine.listMemories(...request.args as Parameters<OrionFS['listMemories']>); break;
        case 'prune-obsolete': result = await engine.pruneObsoleteMemories(...request.args as Parameters<OrionFS['pruneObsoleteMemories']>); break;
        case 'export': result = await engine.exportSnapshot(); break;
        case 'import': result = await engine.importSnapshot(...request.args as Parameters<OrionFS['importSnapshot']>); break;
        case 'forget': result = await engine.forgetMemories(...request.args as Parameters<OrionFS['forgetMemories']>); break;
        case 'update-memory': result = await engine.updateMemory(...request.args as Parameters<OrionFS['updateMemory']>); break;
        case 'has-ingested': result = engine.hasIngestedTurn(String(request.args[0])); break;
        case 'source-retention': result = await engine.setSourceRetention(...request.args as Parameters<OrionFS['setSourceRetention']>); break;
        case 'reset-source': result = await engine.resetIngestedSource(...request.args as Parameters<OrionFS['resetIngestedSource']>); break;
        case 'restore-conversation': result = await engine.restoreConversationSnapshot(...request.args as Parameters<OrionFS['restoreConversationSnapshot']>); break;
        case 'remove': result = engine.removeConversation(String(request.args[0])); break;
        case 'close': engine.close(); parentPort!.postMessage({ id: request.id, result: null }); parentPort!.close(); return;
        default: throw new Error('Unknown OFS operation');
      }
      parentPort!.postMessage({ id: request.id, result });
    } catch (error) { parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
  });
});
