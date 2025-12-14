export class SignatureQueueContract
{
  /**
   * Enfileira um pedido na fila de assinaturas pendentes
   * @param {{requestId: string; shortId: string; provider?: string}} message
   * @returns {Promise<void>}
   */
  async sendToPendingSignaturesQueue(message) {
    throw new Error("Method sendToPendingSignaturesQueue(message) must be implemented");
  }
}