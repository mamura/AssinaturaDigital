export class ServiceCacheEntry {
  /**
   * @param {{
   *  entryKey: string;
   *  entryValue: any;
   *  createdAt?: number | null;
   *  updatedAt?: number | null;
   * }} params
   */
  constructor(params)
  {
    this.entryKey   = params.entryKey;
    this.entryValue = params.entryValue;
    this.createdAt  = params.createdAt ?? null;
    this.updatedAt  = params.updatedAt ?? null;
  }

  static createNew({ entryKey, entryValue, now = Date.now() })
  {
    return new ServiceCacheEntry({
      entryKey,
      entryValue,
      createdAt: now,
      updatedAt: now,
    });
  }
}