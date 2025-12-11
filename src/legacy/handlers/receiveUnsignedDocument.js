"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const signerAuthHelper = require("../helpers/signerAuthToken");
const requesterClientHelper = require("../helpers/requesterClient");
const dataCompressionHelper = require("../helpers/dataCompression");
const shortIdHelper = require("../helpers/shortId");
const apiGatewayHelper = require("../helpers/apiGateway");
const xmlParser = require("fast-xml-parser");
const signaturesTable = require("../resources/tables/signatures");
const pendingSignaturesQueue = require("../resources/queues/pendingSignatures");

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

    const inputBodySchema = {
      "$id": "signature-receiveDocument-inputBody",
      "$async": true,
      "type": "object",
      "properties": {
        "signerAuthToken": {
          "type": "string",
          "pattern": "^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$"
        },
        "signerIdentity": { 
          "type": "string",
          "oneOf": globals.specs.allowedIdentityPatterns.map((signerIdentityPattern) => {
              return {
                "pattern": signerIdentityPattern
              }
            })
        },
        "signerCertificateAlias": {
          "type": "string",
          "pattern": "[0-9a-zA-Z\:\-\s]+"
        },
        "document": {
          "type": "object",
          "properties": {
            "correlationId": {
              "oneOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "integer"
                }
              ]
            },
            "kind": {
              "type": "string",
              "enum": Object.keys(globals.specs.allowedDocumentKinds)
            },
            "xmlContent": {
              "type": "string",
              "pattern": "^<.*>$"
            }
          },
          "additionalProperties": false,
          "required": [
            "correlationId",
            "kind",
            "xmlContent"
          ]
        },
        "revoke": {
          "oneOf": [
            {
              "type": "string",
              "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "callbackUrl": {
          "type": "string",
          "format": "uri",
          "pattern": "^https://.*$"
        },
        "signatureAttributes" : {
          "type": "object",
          "minProperties": 1,
          "properties": {
            "commitmentTypeIndication": { // please refer to https://tools.ietf.org/html/rfc5126#section-5.11.1 for further information
              "type": "string",
              "enum": Object.keys(globals.specs.signatureAttributes.commitmentTypeIndication.allowedValues)
            } 
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false,
      "required": [
        "signerAuthToken",
        "signerCertificateAlias",
        "document",
        "callbackUrl"
      ]
    };

    let requestBody = await requestHelper.parseBody(lambdaEvent.body, inputBodySchema);

    let validatedSignerAuthToken = await signerAuthHelper.validateSignerAuthToken(requestBody.signerAuthToken);
    validatedSignerAuthToken.sub = validatedSignerAuthToken.sub.replace(/(\.|\-)/g, "");

    requestBody.signatureAttributes = requestBody.signatureAttributes || {};
    requestBody.signatureAttributes.commitmentTypeIndication = requestBody.signatureAttributes.commitmentTypeIndication || 
                                                                  globals.specs.signatureAttributes.commitmentTypeIndication.defaultValue;

    try {
      await requesterClientHelper.checkRequesterCallbackUrlByApiKey(lambdaEvent.requestContext.identity.apiKeyId, requestBody.callbackUrl);
    } catch (e) {
      throw errorHandlerHelper.error(e.statusCode, "CallbackUrlValidationError", "Failed to validate callback URL.", e); 
    }

    if (xmlParser.validate(requestBody.document.xmlContent) !== true) {
      throw errorHandlerHelper.error(400, "InvalidParameterError", "Document content is not a valid XML structure."); 
    } else {
      requestBody.document.mediaType = "application/xml";
    }

    requestBody.document.fileName = `${requestBody.document.kind}_${requestBody.document.correlationId}_${lambdaContext.awsRequestId}.xml`;

    // Try compressing document content to store it into DB
    let compressedDocumentContent = null;
    try {
      compressedDocumentContent = await dataCompressionHelper.compress(requestBody.document.xmlContent);
    } catch (e) {
      console.warn("There was an error while trying to compress the received XML content. Proceeding storing in a uncompressed format anyway.", e);
    }

    if (compressedDocumentContent) {
      requestBody.document.xmlContent = compressedDocumentContent.compressedData;
      requestBody.document.compression = compressedDocumentContent.format;
    } else {
      requestBody.document.compression = null;
    }
    
    // Defining current service instance callback URL
    let serviceNotificationCallback = `https://${lambdaEvent.requestContext.domainName}`;
    let stagePrefix = lambdaEvent.requestContext.path.split("/");
    if (Array.isArray(stagePrefix) && stagePrefix.length > 0) {
      for (let i = 0, totI = stagePrefix.length; i < totI; i++) {
        if (stagePrefix[i].length > 0) {
          stagePrefix = stagePrefix[i];
          break;
        }
      }
    } else {
      stagePrefix = null;
    }
    if (stagePrefix && stagePrefix.toLowerCase() === lambdaEvent.requestContext.stage.toLowerCase()) {
      serviceNotificationCallback += `/${stagePrefix}`; 
    }
    serviceNotificationCallback += `/signature/ready/${lambdaContext.awsRequestId}/?providerSignatureId=`;

    let dataToPersist = {
      "sts": "PENDING",
      "signerAuthorization": validatedSignerAuthToken.accessToken,
      "signerAuthorizationExp": validatedSignerAuthToken.exp,
      "provider":  validatedSignerAuthToken.provider,
      "environment": validatedSignerAuthToken.environment || null,
      "serviceNotificationCallback": serviceNotificationCallback,
      ...requestBody
    };

    let shortId = shortIdHelper.generateShortId();
    let existingRecord = await signaturesTable.queryByShortId(shortId, ["shortId"]);

    while (Array.isArray(existingRecord) && existingRecord.length > 0) {
      shortId = shortIdHelper.generateShortId();
      existingRecord = await signaturesTable.queryByShortId(shortId, ["shortId"]);
    }

    const tableKey = {
      "requestId": lambdaContext.awsRequestId,
      "signerIdentity": validatedSignerAuthToken.sub,
      "shortId": shortId
    };

    try {
      await signaturesTable.put(tableKey, dataToPersist, lambdaEvent.requestContext.identity);
    } catch (e) {
      throw errorHandlerHelper.error(500, "UnsignedDocumentPersistenceError", "Failed to persist unsigned document into database. Unable to proceed.", e); 
    }

    try {
      let dataToSendToQueue = {
        "signerIdentity": validatedSignerAuthToken.sub,
        "signerAuthorizationExp": validatedSignerAuthToken.exp,
        "documentCorrelationId": requestBody.document.correlationId, 
        "documentKind": requestBody.document.kind,
        "provider":  validatedSignerAuthToken.provider,
        "environment": validatedSignerAuthToken.environment || null,
        "clientName": await apiGatewayHelper.getClientName(lambdaEvent.requestContext.identity.apiKeyId),
        "sts": dataToPersist.sts
      };

      await pendingSignaturesQueue.sendMessage(lambdaContext.awsRequestId, dataToSendToQueue);
    } catch (e) {
      console.warn("An error has occurred while sending received unsigned document to pending signatures queue. It will be reprocessed by cron retry tasks later on.", e);
      dataToPersist = {
        "sts": "PENDING_SIGNATURE_QUEUE_FAILED"
      };

      try {
        await signaturesTable.update(tableKey, dataToPersist);
      } catch (e) {
        e = errorHandlerHelper.error(500, "PendingSignatureQueueStatusUpdateError", "An error has ocurred while changing status of signature that failed to be put into pending queue.", e); 
        console.warn("It was not possible to update status of received unsigned document that was failed to be put into pending signatures queue. That is not so terrible. It will be retried by cron retry later on.", e);
      }
    }

    let revokeCompleted = false;

    if (typeof requestBody.revoke === "string") {
      try {
        let revokeDataToPersist = {
          "replacedBy": lambdaContext.awsRequestId
        }

        let revokeSignatureTableKey = {
          "requestId": requestBody.revoke,
          "signerIdentity": validatedSignerAuthToken.sub
        }

        let revokedUpdateResult = await signaturesTable.update(revokeSignatureTableKey, revokeDataToPersist, null, {"returnValues": "UPDATED_NEW"});
        if (Object.keys(revokedUpdateResult || {}).length === 0) {
          throw errorHandlerHelper.error(404, "RevokedSignatureNotFound", "The informed revoked signature was not found."); 
        }
        revokeCompleted = true;
      } catch (e) {
        e = errorHandlerHelper.error(500, "RevokeSignatureError", "An error has ocurred while revoking previous signature record", e);
        console.warn("It was not possible to revoke requested signature record.", e); 
      }
    };

    let resultToReturn = {
      "requestId": lambdaContext.awsRequestId,
      "shortId": tableKey.shortId,
      "provider": validatedSignerAuthToken.provider,
      "environment":  validatedSignerAuthToken.environment,
      "signerIdentity": validatedSignerAuthToken.sub,
      "signerCertificateAlias": requestBody.signerCertificateAlias,
      "signatureAttributes": requestBody.signatureAttributes,
      "document": {
        "correlationId": requestBody.document.correlationId,
        "kind": requestBody.document.kind
      },
      "revoke": requestBody.revoke ? requestBody.revoke : null,
      "revokeCompleted": requestBody.revoke ? revokeCompleted : null,
      "callbackUrl": `${requestBody.callbackUrl}`
    };

    return responseHelper.success(lambdaContext.awsRequestId, resultToReturn, 202);
  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
};