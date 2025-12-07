import { SignaturesRepositoryContract } from "../contracts/SignaturesRepositoryContract.js";
import { DomainError } from "../../domain/errors/DomainError.js";
import { SignatureStatusService } from "../../domain/services/SignatureStatusService.js";

/**
 * @param {{ signaturesRepository: SignaturesRepositoryContract }} deps
 */
export function makeCheckSignatureStatusUseCase({ signaturesRepository }) {
  const signatureStatusService = new SignatureStatusService();

  return async function checkSignatureStatusUseCase({ requestIdOrShortId }) {
    // Validação do parametro
    if (!requestIdOrShortId || typeof requestIdOrShortId !== 'string') {
      throw new DomainError(
        "InvalisRequerstIdOrShortId",
        "Parameter 'requestIdOrShortId'must be a non-empty string.",
        400
      );
    }

    if (requestIdOrShortId.trim().length < 17) {
      throw new DomainError(
        "InvalisRequerstIdOrShortId",
        "Parameter 'requestIdOrShortId'must have at leat 17 characters.",
        400
      );
    }

    // Detecta se é UUID ou shortId
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