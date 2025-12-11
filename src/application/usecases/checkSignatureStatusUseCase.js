import { SignaturesRepositoryContract } from "../contracts/SignaturesRepositoryContract.js";
import { DomainError } from "../../domain/errors/DomainError.js";
import { SignatureStatusService } from "../../domain/services/SignatureStatusService.js";

/**
 * @param {{ signaturesRepository: SignaturesRepositoryContract }} deps
 */
export function makeCheckSignatureStatusUseCase({ signaturesRepository }) {
  const signatureStatusService = new SignatureStatusService();

  return async function checkSignatureStatusUseCase({
    requestIdOrShortId,
    subjectAuthorizeParamValue = null,
    subjectAuthorizeParamKind = null,
  } = {}) {
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
    
    let signatureDetails  = null;
    let replacedByShortId = null;

    // Só carrega detalhes se o status for SIGNED
    if (signatureRecord.sts === "SIGNED") {
      signatureDetails = 
        await signaturesRepository.findDetailsForStatusCheck(
          signatureRecord.requestId
        );

      if (!signatureDetails) {
        throw new DomainError(
          "DocumentDetailsNotFound",
          "No document has been found for the parameters informed.",
          404
        );
      }

      if (!signatureDetails?.unsignedDocument?.kind) {
        throw new DomainError(
          "MissingDocumentKind",
          "There is an inconsistency error: document kind not recorded on DB! Unable to proceed.",
          409
        );
      }

      // se houver replacedBy, tenta descobrir o shortId da assinatura de substituição
      if (signatureDetails.replacedBy) {
        try {
          const replacementRecords = await signaturesRepository.queryByRequestId(signatureDetails.replacedBy);

          if (
            replacementRecords &&
            Array.isArray(replacementRecords) &&
            replacementRecords.length === 1
          ) {
            signatureDetails.replacedByShortId = replacementRecords[0].shortId;
          }
        } catch (e) {
          console.warn(
            "Error loading replacement signature data, proceeding with REPLACED without shortId",
            err
          );
        }
      }
    }

    if (signatureDetails) {
      signatureDetails.replacedByShortId = replacedByShortId;
    }

    const subjectAuthorizeParams = {
      paramKind: subjectAuthorizeParamKind,
      paramValue: subjectAuthorizeParamValue,
    };

    return signatureStatusService.buildStatusResponse(
      signatureRecord,
      signatureDetails,
      subjectAuthorizeParams
    );
  }
}