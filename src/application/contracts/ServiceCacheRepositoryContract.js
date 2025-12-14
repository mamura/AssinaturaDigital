export class ServiceCacheRepositoryContract
{
  /**
   * Busca item de cache pela chave.
   * @param {string} entryKey
   * @returns {Promise<import('../../domain/entities/ServiceCacheEntry.js').ServiceCacheEntry | null>}
   */
  async get(entryKey)
  {
    throw new Error("Method get(entryKey) must be implemented");
  }
  
  /**
   * Cria um novo item de cache.
   * @param {import('../../domain/entities/ServiceCacheEntry.js').ServiceCacheEntry} entry
   * @returns {Promise<void>}
   */
  async put(entry)
  {
    throw new Error("Method put(entry) must be implemented");
  }

  /**
   * Atualiza o valor de um item de cache existente.
   * @param {string} entryKey
   * @param {any} entryValue
   * @returns {Promise<void>}
   */
  async update(entryKey, entryValue)
  {
    throw new Error("Method update(entryKey, entryValue) must be implemented");
  }
}