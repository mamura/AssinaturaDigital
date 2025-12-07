"use strict";

const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const signaturesTable = require("../resources/tables/signatures");
const registeredReadySignaturesQueue = require("../resources/queues/registeredReadySignatures");
const providers = require("../providers");

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
      "$id": "signature-saveSignedDocument-inputPathParameters",
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

    const queryStringParametersSchema = {
      "$id": "signature-saveSignedDocument-inputQueryStringParameters",
      "$async": true,
      "type": "object",
      "properties": {
        "providerSignatureId": {
          "type": "string",
          "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
        }
      },
      "additionalProperties": false,
      "required": [
        "providerSignatureId"
      ]
    };
    let queryStringParameters = await requestHelper.parseQueryStringParams(lambdaEvent.queryStringParameters, queryStringParametersSchema);

    let signatureRequestRecord = await signaturesTable.queryByRequestId(pathParameters.requestId, ["signerIdentity", "providerSignatureId", "provider", "sts", "requestOrigin.client", "unsignedDocument.correlationId", "unsignedDocument.kind"]);

    if (!Array.isArray(signatureRequestRecord) || signatureRequestRecord.length === 0) {
      throw errorHandlerHelper.error(404, "SignatureRequestNotFound", "No signature request record found for the parameters informed."); 
    }

    if (signatureRequestRecord.length > 1) {
      throw errorHandlerHelper.error(409, "IndeterministicSignatureRecordError", `More than one signature request record has been found for requestId ${pathParameters.requestId}.`); 
    }

    signatureRequestRecord = signatureRequestRecord[0];

    if (signatureRequestRecord.sts === "SIGNED") { //signed document is already persisted
      console.info(`Document signature with requestId ${pathParameters.requestId} is already concluded. This is possibly due to service asynchornous behavior. Immediately returning success response anyway.`);
    } else {
      const processableSignatureStatus = [
        "PROVIDER_TRANSACTION_STARTED",
        "UPLOADED_TO_PROVIDER",
        "UPLOAD_TO_PROVIDER_FAILED",
        "REGISTER_READY_SIGNATURE_QUEUE_FAILED"
      ];
  
      if (processableSignatureStatus.includes(signatureRequestRecord.sts)) {
        let dataToPersist = {};
        let providerSigneatureIdInconsistencyError = null;
        let checkSignatureStatusError = null;
        let readySignatureUrlFileError = null;
        let registeredReadySignaturesQueueError = null;
        let updateStatusError = null;
  
        if (signatureRequestRecord.providerSignatureId !== queryStringParameters.providerSignatureId) {
          providerSigneatureIdInconsistencyError = errorHandlerHelper.error(409, "SignatureIdConflictError", `Signature identifier informed diverges from the one registered on request signature record. Unable to proceed.`); 
          dataToPersist.sts = "PROVIDER_SIGNATURE_ID_INCONSISTENCY";
        }
  
        if (!providerSigneatureIdInconsistencyError) {
          let readySignatureFileUrl = null;
          let signatureStatusCheck = null;
          
          let provider = await providers.loadProvider(signatureRequestRecord.provider);

          try {
            signatureStatusCheck = await provider.checkSignatureTransactionStatus(signatureRequestRecord.providerSignatureId);
          } catch (e) {
            checkSignatureStatusError = e;
            dataToPersist.sts = "CHECK_SIGNATURE_REQUEST_ERROR";
          }

          if (!checkSignatureStatusError) {
            let signatureStatus = (signatureStatusCheck.document || {}).signatureStatus;
            
            switch (signatureStatus) {
              case "SIGNED":
                readySignatureFileUrl = (signatureStatusCheck.document || {}).signedFileUrl;
                
                if (!readySignatureFileUrl || readySignatureFileUrl == '') {
                  console.warn('Signature status check endpoint did not returne the signature file URL. Trying to extract it from provider callback body...');
                  try {
                    readySignatureFileUrl = await provider.getReadySignatureFileUrl(lambdaEvent.body);
                  } catch (e) {
                    console.warn('Error parsing provider callback body to get ready signature file URL.', e);
                    readySignatureUrlFileError = e;
                    dataToPersist.sts = "READY_SIGNATURE_FILE_URL_ERROR";
                  }
                }

                if (!readySignatureUrlFileError) {
                  try {
                    let dataToSendToQueue = {
                      "clientName": signatureRequestRecord.requestOrigin.client,
                      "providerSignatureId": signatureRequestRecord.providerSignatureId,
                      "documentCorrelationId": signatureRequestRecord.unsignedDocument.correlationId, 
                      "documentKind": signatureRequestRecord.unsignedDocument.kind,
                      "readySignatureFileUrl": (typeof readySignatureFileUrl !== "string") ? `${readySignatureFileUrl.baseURL}${readySignatureFileUrl.url}` : readySignatureFileUrl
                    };
            
                    await registeredReadySignaturesQueue.sendMessage(pathParameters.requestId, dataToSendToQueue);
                  } catch (e) {
                    registeredReadySignaturesQueueError = e;
                    dataToPersist.sts = "REGISTER_READY_SIGNATURE_QUEUE_FAILED";
                  }
      
                  if (!registeredReadySignaturesQueueError) {
                    dataToPersist.sts = "READY_TO_DOWNLOAD";
                  }
                }
                
                break;
              case "WAITING":
                console.info(`Signature for requestId ${pathParameters.requestId} is not ready yet. It will be retried on a cron retry execution.`);
                break;
              case "ERROR":
                console.warn(`Signature for requestId ${pathParameters.requestId} has failed.`);
                dataToPersist.sts = "SIGNATURE_ERROR";
                break;
              default:
                console.warn(`Signature status check for requestId ${pathParameters.requestId} has returned an unknown status: ${signatureStatus}.`);
                dataToPersist.sts = "UNKNOWN_SIGNATURE_STATUS";
            };
          }
        }

        try {
          if (dataToPersist.sts) {
            const tableKey = {
              "requestId": pathParameters.requestId,
              "signerIdentity": signatureRequestRecord.signerIdentity
            }; 
        
            let tableUpdateConditions = {
              "expression": "sts IN (",
              "values": {}
            };
            for (let s = 0, totS = processableSignatureStatus.length; s < totS; s++) {
              tableUpdateConditions.expression += `:cond_sts${s+1}, `;
              tableUpdateConditions.values[`:cond_sts${s+1}`] = processableSignatureStatus[s];
            }
            tableUpdateConditions.expression = tableUpdateConditions.expression.substring(0, tableUpdateConditions.expression.length-2) + ")";
      
            await signaturesTable.update(tableKey, dataToPersist, tableUpdateConditions);
          }
        } catch (e) {
          updateStatusError = errorHandlerHelper.error(500, "ReadySignatureStatusUpdateError", "An error has occurred while updating status of signature request record.", e); 
        }
    
        // If a known failure has ocurred, then throw the exception
        let exception = providerSigneatureIdInconsistencyError || checkSignatureStatusError || readySignatureUrlFileError || registeredReadySignaturesQueueError || updateStatusError;
        if (exception) {
          throw exception;
        }
      } else {
        throw errorHandlerHelper.error(500, "InvalidSignatureStateError", `Signature request record for requestId ${pathParameters.requestId} and providerSignatureId ${signatureRequestRecord.providerSignatureId} is at a state that does not allow further processing in this stage. Current status: ${signatureRequestRecord.sts}.`); 
      }
    }

    //If everything went fine so far, return the succeded result
    return responseHelper.success(lambdaContext.awsRequestId, {"requestId": pathParameters.requestId, "providerSignatureId": signatureRequestRecord.providerSignatureId, "sts": "OK"});
  } catch (e) {
    return responseHelper.failure(lambdaContext.awsRequestId, e);
  }
};
