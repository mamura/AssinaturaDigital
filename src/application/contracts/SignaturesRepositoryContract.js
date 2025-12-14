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
  async findByRequestIdAndSigner(requestId, signerIdentity) {
    throw new Error("Method findByRequestId(requestId) must be implemented");
  }

  /**
   * Busca uma assinatura pelo seu shortId
   * @param {string} shortId
   * @returns {Promise<import('../../domain/entities/Signature.js').Signature | null>}
   */
  async findByShortId(shortId) {
    throw new Error("Method findByShortId(shortId) must be implemented");
  }

  /**
   * Atualiza campos mutáveis da assinatura
   * @param {string} requestId
   * @param {string} signerIdentity
   * @param {Partial<import('../../domain/entities/Signature.js').Signature>} partial
   * @returns {Promise<void>}
   */
  async update(requestId, signerIdentity, partial) {
    throw new Error("Method update(requestId, signerIdentity, partial) must be implemented");
  }

  /**
   * Gera um shortId único para o pedido de assinatura
   * @returns {Promise<string>}
   */
  async generateShortId() {
    throw new Error("Method generateShortId() must be implemented");
  }
}