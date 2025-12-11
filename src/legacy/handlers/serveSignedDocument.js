"use strict";

const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const apiGatewayHelper = require("../helpers/apiGateway");
const dataCompressionHelper = require("../helpers/dataCompression");
const signaturesTable = require("../resources/tables/signatures");

let lambdaInstanceId = null;

module.exports.handler = async (lambdaEvent, lambdaContext) => {  
  try {
    lambdaInstanceId = lambdaInstanceId || lambdaContext.awsRequestId; // using the first warmup call request ID as unique identifier for this Lambda instance

    // Immediate response for WarmUP plugin
    if (lambdaEvent.source === "serverless-plugin-warmup") {
      return responseHelper.warmup(lambdaInstanceId);
    }

    console.info(`\nLAMBDA INSTANCE ID: ${lambdaInstanceId}`);

    requestHelper.validateLambdaParameters(lambdaEvent, lambdaContext);
    requestHelper.validateRequestId(lambdaContext.awsRequestId);

    const pathParametersSchema = {
      "$id": "signature-serveSignedDocument-inputPathParameters",
      "$async": true,
      "type": "object",
      "properties": {
        "requestId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
        }
      },
      "additionalProperties": false,
      "required": [
        "requestId"
      ]
    };

    let pathParameters = await requestHelper.parsePathParams(lambdaEvent.pathParameters, pathParametersSchema);

    let signatureRequestRecord = await signaturesTable.queryByRequestId(pathParameters.requestId, ["sts", "signedDocument", "requestOrigin.client"]);

    if (!Array.isArray(signatureRequestRecord) || signatureRequestRecord.length === 0) {
      throw errorHandlerHelper.error(404, "DocumentNotFound", "No document has been found for the parameters informed."); 
    }
    signatureRequestRecord = signatureRequestRecord[0];

    //Please, notice that we only must serve documents to the application that originally requested the signature for it or to this service itself (__SELF__)
    let clientName = await apiGatewayHelper.getClientName(lambdaEvent.requestContext.identity.apiKeyId);
    if (signatureRequestRecord.requestOrigin.client !== clientName && clientName !== "__SELF__") {
      throw errorHandlerHelper.error(403, "AccessDenied", "Your application is not allowed to access the requested document.");
    }

    if (["SIGNED", "READY_QUEUE_FAILED", "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"].indexOf(signatureRequestRecord.sts) === -1) {
      if (["PENDING", "PROVIDER_TRANSACTION_STARTED", "UPLOADED_TO_PROVIDER", "READY_TO_DOWNLOAD"].indexOf(signatureRequestRecord.sts) >= 0) { //awaiting status
        throw errorHandlerHelper.error(409, "DocumentNotSignedYet", "The document requested is not signed yet. Please, try again later.");
      } else {
        throw errorHandlerHelper.error(409, "SinatureProcessingFailed", "The signature for the document requested could not be completed. There was an error while processing signture. Please, send document to be signed again.");
      }
    }

    if (!signatureRequestRecord.signedDocument.signedContent) {
      throw errorHandlerHelper.error(409, "EmptySignedDocument", "The document might be signed, but no content has been found for it. Please, contact service administrator.");
    }

    // If signed document content has been stored in a compressed format, then uncompress it before sending content to requester
    if (signatureRequestRecord.signedDocument.compression) {
      let uncompressedDocumentContent = await dataCompressionHelper.uncompress(signatureRequestRecord.signedDocument.signedContent, signatureRequestRecord.signedDocument.compression);
      signatureRequestRecord.signedDocument.signedContent = uncompressedDocumentContent;
    }

    let returnHeaders = {
      "Content-Type": signatureRequestRecord.signedDocument.mediaType || "application/x-pkcs7-signature",
      "Content-Transfer-Encoding": "binary",
      "Transfer-Encoding": "chunked",
      "Content-Disposition": `attachment; filename=${signatureRequestRecord.signedDocument.fileName}`
    }

    return responseHelper.serveFile(lambdaContext.awsRequestId, signatureRequestRecord.signedDocument.signedContent, returnHeaders, "Signed document retrieved successfully!");
  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
}