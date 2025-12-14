export class SignatureStorageContract
{
  /**
   * Salva o documento ainda não assinado
   * @param {{requestId: string; content: Buffer | string; filename?: string; mimeType?: string}} params
   * @returns {Promise<string>} Caminho/URL onde o documento foi salvo
   */
  async saveUnsignedDocument(params) {
    throw new Error("Method saveUnsignedDocument(params) must be implemented");
  }
}