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
      "$id": "signature-serveUnsignedDocument-inputPathParameters",
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

    let signatureRequestRecord = await signaturesTable.queryByRequestId(pathParameters.requestId, ["sts", "unsignedDocument", "requestOrigin.client"]);

    if (!Array.isArray(signatureRequestRecord) || signatureRequestRecord.length === 0) {
      throw errorHandlerHelper.error(404, "DocumentNotFound", "No document has been found for the parameters informed."); 
    }
    signatureRequestRecord = signatureRequestRecord[0];

    //Please, notice that we only must serve documents to the application that originally requested the signature for it or to this service itself (__SELF__)
    let clientName = await apiGatewayHelper.getClientName(lambdaEvent.requestContext.identity.apiKeyId);
    if (signatureRequestRecord.requestOrigin.client !== clientName && clientName !== "__SELF__") {
      throw errorHandlerHelper.error(403, "AccessDenied", "Your application is not allowed to access the requested document.");
    }

    if (!signatureRequestRecord.unsignedDocument.xmlContent) {
      throw errorHandlerHelper.error(409, "EmptyUnsignedDocument", "No content has been found on unsigned document. Please, contact service administrator.");
    }

    // If unsigned document content has been stored in a compressed format, then uncompress it before sending content to requester
    if (signatureRequestRecord.unsignedDocument.compression) {
      let uncompressedDocumentContent = await dataCompressionHelper.uncompress(signatureRequestRecord.unsignedDocument.xmlContent, signatureRequestRecord.unsignedDocument.compression);
      signatureRequestRecord.unsignedDocument.xmlContent = uncompressedDocumentContent;
    }

    if (signatureRequestRecord.unsignedDocument.mediaType !== "application/xml") {
      throw errorHandlerHelper.error(415, "UnsupportedMediaType", "The media type of the document stored stored is not supported yet.");   
    }

    if (!(signatureRequestRecord.unsignedDocument.xmlContent instanceof Buffer)) {
      signatureRequestRecord.unsignedDocument.xmlContent = new Buffer(signatureRequestRecord.unsignedDocument.xmlContent);
    }

    let returnHeaders = {
      "Content-Type": signatureRequestRecord.unsignedDocument.mediaType,
      "Content-Disposition": `attachment; filename=${signatureRequestRecord.unsignedDocument.fileName}`
    };

    return responseHelper.serveFile(lambdaContext.awsRequestId, signatureRequestRecord.unsignedDocument.xmlContent, returnHeaders, "Unsigned copy of the document retrieved successfully!");
  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
};