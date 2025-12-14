export class SignatureCheckRepositoryContract
{
  /**
   * Cria um novo registro de checagem de status
   * @param {import('../../domain/entities/SignatureCheck').SignatureCheck} check
   * @returns {Promise<void>}
   */
  async create(check)
  {
    throw new Error("Method create(check) must be implemented");
  }

  /**
   * Busca um registro de checagem por requestId
   * @param {string} requestId
   * @returns {Promise<import('../../domain/entities/SignatureCheck').SignatureCheck | null>}
   */
  async findByRequestId(requestId)
  {
    throw new Error("Method findByRequestId(requestId) must be implemented");
  }
}