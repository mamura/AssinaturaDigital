import { SignaturesRepositoryContract } from "../../application/contracts/SignaturesRepositoryContract.js";

export class InMemorySignaturesRepository extends SignaturesRepositoryContract {
  constructor(initialData = []) {
    super();
    this.records = [...initialData];
  }

  async queryByShortId(shortId) {
    return this.records.filter((item) => item.shortId === shortId);
  }

  async queryByRequestId(requestId) {
    return this.records.filter((item) => item.requestId === requestId);
  }

  async incrementCheckCounter(key, checkId, initializeIfMissing) {
    const idx = this.records.find(
      (it) =>
        it.requestId === key.requestId &&
        it.signerIdentity === key.signerIdentity
    );

    if (idx === -1) {
      if (!initializeIfMissing) {
        return;
      }
      
      this.records.push({
        requestId: key.requestId,
        signerIdentity: key.signerIdentity,
        shortId: null,
        sts: "UNKNOWN",
        unsignedDocument: null,
        signedDocument: null,
        replacedBy: null,
        checkCounter: 1,
      });

      return;
    }

    const current = this.records[idx];
    const base = initializeIfMissing
      ? current.checkCounter ?? 0
      : current.checkCounter ?? 1;

    this.records[idx] = {
      ...current,
      checkCounter: base + 1,
      lastCheckId: checkId,
    };
  }

  async findDetailsForStatusCheck(requestId) {
    return (
      this.records.find((r) => r.requestId === requestId) || null
    );
  }
}
