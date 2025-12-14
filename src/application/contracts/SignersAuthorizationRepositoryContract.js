export class SignersAuthorizationRepositoryContract
{
  /**
   * Cria um registro de autorização de signatário
   * @param {import('../../domain/entities/SignerAuthorization.js').SignerAuthorization} authorization
   * @returns {Promise<void>}
   */
  async create(authorization)
  {
    throw new Error("Method create(authorization) must be implemented");
  }

  /**
   * Busca autorização pelo par (requestId, signerIdentity)
   * @param {string} requestId
   * @param {string} signerIdentity
   * @returns {Promise<import('../../domain/entities/SignerAuthorization.js').SignerAuthorization | null>}
   */
  async findByRequestIdAndSigner(requestId, signerIdentity)
  {
    throw new Error("Method findByRequestIdAndSigner(requestId, signerIdentity) must be implemented");
  }

  /**
   * Atualiza campos mutáveis da autorização do signatário
   * @param {string} requestId
   * @param {string} signerIdentity
   * @param {Partial<import('../../domain/entities/SignerAuthorization.js').SignerAuthorization>} partial
   * @returns {Promise<void>}
   */
  async update(requestId, signerIdentity, partial)
  {
    throw new Error("Method update(requestId, signerIdentity, partial) must be implemented");
  }
}