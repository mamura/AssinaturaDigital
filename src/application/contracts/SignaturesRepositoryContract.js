export class SignaturesRepositoryContract {
  
  /**
   * Cria um novo pedido de assinatura
   * @param {import('../../domain/signatures/SignatureRequest')} signatureRequest
   * @returns {Promise<void>}
   */
  async create(signatureRequest) {
    throw new Error("Method create(signatureRequest) must be implemented");
  }

  /**
   * Retorna um pedido de assinatura pelo seu requestId
   * @param {string} requestId
   * @returns {Promise<import('../../domain/signatures/SignatureRequest') | null>}
   */
  async findByRequestId(requestId) {
    throw new Error("Method findByRequestId(requestId) must be implemented");
  }

  /**
   * Gera um shortId único para o pedido de assinatura
   * @returns {Promise<string>}
   */
  async generateShortId() {
    throw new Error("Method generateShortId() must be implemented");
  }


  async queryByShortId(shortId) {
    throw new Error("Method queryByShortId(shortId) must be implemented");
  }

  async queryByRequestId(requestId) {
    throw new Error("Method queryByRequestId(requestId) must be implemented");
  }

  async incrementCheckCounter(key, checkId, initializeIfMissing) {
    throw new Error("Method incrementCheckCounter(...) must be implemented");
  }

  async findDetailsForStatusCheck(requestId) {
    throw new Error("Method findDetailsForStatusCheck(requestId) must be implemented");
  }
}