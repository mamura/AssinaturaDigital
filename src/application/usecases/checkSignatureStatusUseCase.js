import { SignaturesRepositoryContract } from "../contracts/SignaturesRepositoryContract.js";
import { DomainError } from "../../domain/errors/DomainError.js";
import { SignatureStatusService } from "../../domain/services/SignatureStatusService.js";

/**
 * @param {{ signaturesRepository: SignaturesRepositoryContract }} deps
 */
export function makeCheckSignatureStatusUseCase({ signaturesRepository }) {
  const signatureStatusService = new SignatureStatusService();

  return async function checkSignatureStatusUseCase({ requestIdOrShortId }) {
    // Detecta se é UUID
    const isUuid = /^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/.test(requestIdOrShortId);

    const records = isUuid
      ? await signaturesRepository.queryByRequestId(requestIdOrShortId)
      : await signaturesRepository.queryByShortId(requestIdOrShortId);

    if (!records || records.length === 0) {
      throw new DomainError(
        "DocumentNotFound",
        "No document has been found for the parameters informed.",
        404,
      );
    }

    if (records.length > 1) {
      throw new DomainError(
        "UndeterministicError",
        "More than one document found for the parameters informed.",
        409,
      );
    }

    const signatureRecord = records[0];

    return signatureStatusService.buildStatusResponse(signatureRecord);
  }
}