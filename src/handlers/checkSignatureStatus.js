import { makeCheckSignatureStatusUseCase } from "../application/usecases/checkSignatureStatusUseCase.js";
import { responseFailure, responseSuccess } from "../infrastructure/helpers/response.js";
import { makeSignaturesRepository } from "../infrastructure/repositories/SignaturesRepositoryFactory.js";

const signaturesRepository  	    = makeSignaturesRepository();
const checkSignatureStatusUseCase = makeCheckSignatureStatusUseCase({ signaturesRepository });

export const handler = async (event, context) => {
  try {
    const { requestIdOrShortId } = event.pathParameters || {};

    const {
      subjectAuthorizeParamKind = null,
      subjectAuthorizeParamValue = null,
    } = event.queryStringParameters || {};

    const result = await checkSignatureStatusUseCase({
      requestIdOrShortId,
      subjectAuthorizeParamKind,
      subjectAuthorizeParamValue
    });

    return responseSuccess(context.awsRequestId, result);
  
  } catch (err) {
    console.error("Unhandled error in checkSignStatus handler:", err);
    return responseFailure(context.awsRequestId, err);
  }
};
