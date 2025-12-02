"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const requestHelper = require("../helpers/request");
const errorHandlerHelper = require("../helpers/errorHandler");
const httpClientHelper = require("../helpers/httpClient");
const dataCompressionHelper = require("../helpers/dataCompression");
const signaturesTable = require("../resources/tables/signatures");
const readyOrErroredSignaturesQueue = require("../resources/queues/readyOrErroredSignatures");

let lambdaInstanceId = null;

module.exports.handler = async (lambdaEvent, lambdaContext) => {
  let syncOriginRequestId = [];

  try {
    lambdaInstanceId = lambdaInstanceId || lambdaContext.awsRequestId; // using the first warmup call request ID as unique identifier for this Lambda instance

    // Immediate response for WarmUP plugin
    if (lambdaEvent.source === "serverless-plugin-warmup") {
      return responseHelper.warmup(lambdaInstanceId);
    }

    console.info(`\nLAMBDA INSTANCE ID: ${lambdaInstanceId}`);

    requestHelper.validateLambdaParameters(lambdaEvent, lambdaContext);
    requestHelper.validateRequestId(lambdaContext.awsRequestId);

    const batchSize = parseInt(process.env.LAMBDA_SAVE_SIGNED_DOCUMENT_READ_SQS_BATCH_SIZE || 1);

    const inputBodySchema = {
      "$id": "signature-saveSignedDocument-inputBody",
      "$async": true,
      "type": "array",
      "uniqueItems": true,
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "messageId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "receiptHandle": {
            "type": "string",
            "minLength": 100
          },
          "messagePayload": {
            "oneOf": [
              {
                "type": "string",
                "pattern": `^((${globals.specs.enabledCallbackDomains.map((cliCallbackDomain) => { return cliCallbackDomain.client;}).join("|")})\|){0,1}(${Object.keys(globals.specs.allowedDocumentKinds).join("|")})\|([a-zA-z0-9])+$`
              },
              {
                "type": "null"
              }
            ]
          },
          "requestId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "providerSignatureId": {
            "type": "string",
            "pattern": "^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$"
          },
          "readySignatureFileUrl": {
            "type": "string",
            "format": "uri"
          }
        },
        "additionalProperties": false,
        "required": [
          "messageId",
          "receiptHandle",
          "messagePayload",
          "requestId",
          "providerSignatureId",
          "readySignatureFileUrl"
        ]
      }
    };

    let requestBody = await requestHelper.parseSqsBody(lambdaEvent, inputBodySchema, batchSize);
    
    let promisesSaveSignedDocument = [];

    requestBody.forEach((reqBody) => {
      syncOriginRequestId.push(reqBody.requestId);
      promisesSaveSignedDocument.push({
        "syncOriginRequestId": reqBody.requestId,
        "promise": newSaveSignedDocumentPromise(reqBody)
      });
    });

    let allPromisesResults = await Promise.all(promisesSaveSignedDocument.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Promise for requestId ${pendingPromise.syncOriginRequestId} successfully executed.`);
        return {
          "syncOriginRequestId": pendingPromise.syncOriginRequestId,
          "result": res
        };
      })
      .catch((e) => {
        console.warn(`An error has occurred while processing promise for requestId ${pendingPromise.syncOriginRequestId}.`, e);
        return {
          "syncOriginRequestId": pendingPromise.syncOriginRequestId,
          "result": e
        }
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "PromiseAllSaveSignedDocumentError", "An unexpected error has ocurred while executing all promises for saving signed document.", e);
    });
    return responseHelper.asyncSuccess(lambdaContext.awsRequestId, syncOriginRequestId, allPromisesResults);
  } catch (e) {
    return responseHelper.asyncFailure(lambdaContext.awsRequestId, syncOriginRequestId, e);
  }
};

const newSaveSignedDocumentPromise = (requestBody) => {
  return new Promise(async (resolve, reject) => {
    try {
      let signatureRequestRecord = await signaturesTable.queryByRequestId(requestBody.requestId, ["requestId", "providerSignatureId", "sts", "provider", "signerIdentity", "unsignedDocument.fileName", "unsignedDocument.kind", "unsignedDocument.correlationId", "requestOrigin.client"]);

      if (!Array.isArray(signatureRequestRecord) || signatureRequestRecord.length === 0) {
        throw errorHandlerHelper.error(404, "SignatureRequestNotFound", "No signature request record found for the parameters informed."); 
      }

      if (signatureRequestRecord.length > 1) {
        await signaturesTable.update(
          {"requestId": requestId}, 
          {"sts": "INDETERMINISTIC_RECORD_ERROR"},
          {"expression": "sts <> :cond_sts", "values": {":cond_sts": "SIGNED"}});
        
        throw errorHandlerHelper.error(409, "IndeterministicSignatureRecordError", `More than one signature request record has been found for requestId ${requestBody.requestId}.`); 
      }

      signatureRequestRecord = signatureRequestRecord[0];

      if (signatureRequestRecord.sts === "SIGNED") { //document signed already persistend
        console.info(`Document signature with requestId ${requestBody.requestId} is already concluded. This is possibly due to service asynchornous behavior. Immediately returning success response anyway.`);
        return resolve(`Signature record is already at status ${signatureRequestRecord.sts}. Nothing to do.`);
      } 
      
      const unprocessableSignatureStatus = [
        "PROVIDER_SIGNATURE_ID_INCONSISTENCY",
        "INDETERMINISTIC_RECORD_ERROR"
      ];
  
      const processableSignatureStatus = [
        "READY_TO_DOWNLOAD",
        "DOWNLOAD_FROM_PROVIDER_FAILED",
        "READY_QUEUE_FAILED",
        "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED",
        "PROVIDER_TRANSACTION_STARTED",
        "UPLOAD_TO_PROVIDER_FAILED",
        "UPLOADED_TO_PROVIDER"
      ];
  
      if (unprocessableSignatureStatus.indexOf(signatureRequestRecord.sts) >= 0) {
        //Just warning in console the invalid state, since it will enable returning a non-failure response and avoid unneccerary retries (once whatever the current state is, it pontentially is a unrecoverable state)
        console.warn(`Signature request record is at a state that does not allow it to be processed. Current state: ${signatureRequestRecord.sts}. Just returning...`);
      } else if (processableSignatureStatus.indexOf(signatureRequestRecord.sts) >= 0) {
        let dataToPersist = {};
        let providerSigneatureIdInconsistencyError = null;
        let downloadSignedDocumentError = null;
        let readySignatureQueueError = null;
        let signedDocument = null;

        const tableKey = {
          "requestId": signatureRequestRecord.requestId,
          "signerIdentity": signatureRequestRecord.signerIdentity
        }; 
  
        if (["READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED", "READY_QUEUE_FAILED"].indexOf(signatureRequestRecord.sts) === -1) { //if record is at either of theses states, then the file has already been downloaded. It just need to notifies the requester
          if (signatureRequestRecord.providerSignatureId !== requestBody.providerSignatureId) {
            providerSigneatureIdInconsistencyError = errorHandlerHelper.error(409, "SignatureIdConflictError", `Signature identifier informed diverges from the one registered on request signature record. Unable to proceed.`); 
            dataToPersist.sts = "PROVIDER_SIGNATURE_ID_INCONSISTENCY";
          }
  
          if (!providerSigneatureIdInconsistencyError) {  
            // Step 1: download the signed document from provider
            try {
              signedDocument = await fetchReadySignatureFile(requestBody.readySignatureFileUrl.replace(/^http:\/\//, "https://"), signatureRequestRecord.unsignedDocument.fileName);
              dataToPersist.sts = "SIGNED";
            } catch (e) {
              downloadSignedDocumentError = e;
              dataToPersist.sts = "DOWNLOAD_FROM_PROVIDER_FAILED";
            }
    
            if (!downloadSignedDocumentError) {
              // Step 2: compressing the signed document content before storing it into DB
              let compressedDocumentContent = null;
              try {
                compressedDocumentContent = await dataCompressionHelper.compress(signedDocument.signedContent);
              } catch (e) {
                console.warn("There was an error while trying to compress the received signed file. Proceeding storing in a uncompressed format anyway.", e);
              }
    
              if (compressedDocumentContent) {
                signedDocument.signedContent = compressedDocumentContent.compressedData;
                signedDocument.compression = compressedDocumentContent.format;
              } else {
                signedDocument.compression = null;
              }
              dataToPersist.signedDocument = signedDocument;
            } 
          }
          
          // update request signature record with success or failture result
          let tableUpdateConditions = {
            "expression": " attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                          " AND size(providerSignatureId) = :cond_size_providerSignatureId " +
                          " AND attribute_type(signedDocument, :cond_attType_signedDocument) " +
                          " AND sts IN (",
            "values": {
              ":cond_attType_providerSignatureId" : "S",
              ":cond_size_providerSignatureId" : 36,
              ":cond_attType_signedDocument": "NULL"
            }
          };
          for (let s = 0, totS = processableSignatureStatus.length; s < totS; s++) {
            tableUpdateConditions.expression += `:cond_sts${s+1}, `;
            tableUpdateConditions.values[`:cond_sts${s+1}`] = processableSignatureStatus[s];
          }
          tableUpdateConditions.expression = tableUpdateConditions.expression.substring(0, tableUpdateConditions.expression.length-2) + ")";
    
          await signaturesTable.update(tableKey, dataToPersist, tableUpdateConditions);
        }
  
        if (!providerSigneatureIdInconsistencyError && !downloadSignedDocumentError) {
          // Step 3: insert a message into ready signature queue to sinalize that a document is ready and requester must be notified
          try {
            let dataToSendToQueue = {
              "clientName": signatureRequestRecord.requestOrigin.client,
              "documentCorrelationId": signatureRequestRecord.unsignedDocument.correlationId, 
              "documentKind": signatureRequestRecord.unsignedDocument.kind
            };
  
            await readyOrErroredSignaturesQueue.sendMessage(signatureRequestRecord.requestId, dataToSendToQueue);
          } catch (e) {
            readySignatureQueueError = e;
            dataToPersist = {
              "sts": "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"
            };
          } finally {
            if (readySignatureQueueError !== null) {
              let tableUpdateConditionsQueueFailed = {
                "expression": " attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " +
                              " AND size(providerSignatureId) = :cond_size_providerSignatureId " +
                              " AND attribute_type(signedDocument, :cond_attType_signedDocument) " +
                              " AND sts = :cond_sts ",
                "values": {
                  ":cond_attType_providerSignatureId" : "S",
                  ":cond_size_providerSignatureId" : 36,
                  ":cond_attType_signedDocument": "M", //Map
                  ":cond_sts": "SIGNED"
                }
              };
              await signaturesTable.update(tableKey, dataToPersist, tableUpdateConditionsQueueFailed);
            }
          }
        }
    
        // If a failure has ocurred in either of steps, then throw the exception
        let exception = providerSigneatureIdInconsistencyError || downloadSignedDocumentError || readySignatureQueueError;
        if (exception) {
          throw exception;
        }
      }
      

      // If everything went fine so far, return the succeded result
      return resolve({"providerSignatureId": signatureRequestRecord.providerSignatureId, "downloadConcluded": true});
    } catch (e) {
      return reject(e);
    }
  });
};

const fetchReadySignatureFile = async (readySignatureFileUrl, alternativeFileName) => {
  try {

    let requestParams = {
      "responseType": "arraybuffer",
      "timeout": 20000
    };

    if (typeof readySignatureFileUrl === "string") {
      requestParams = {
        "url": readySignatureFileUrl,
        ...requestParams
      };
    } else {
      requestParams = {
        "baseURL": readySignatureFileUrl.baseURL,
        "url": readySignatureFileUrl.url,
        ...requestParams
      };
    }

    let readySignatureFileResponse = await httpClientHelper.get(requestParams);

    let fileName = null;
    
    if (readySignatureFileResponse.responseHeaders["content-disposition"]) {
      fileName = readySignatureFileResponse.responseHeaders["content-disposition"].split("filename=")[1];
      fileName = fileName.replace(/"/g, "");
    } else {
      fileName = `${alternativeFileName}.p7s`;
    }
    

    let fileExtension = fileName.split(".").pop();
    let mediaType = null;

    switch(fileExtension) {
      case "p7s":
        mediaType = "application/x-pkcs7-signature";
        break;
      case "p7m":
        mediaType = "application/x-pkcs7-mime";
        break;
      default:
        mediaType = "application/octet-stream";
    }

    if (!(readySignatureFileResponse.responseData instanceof Buffer)) {
      throw errorHandlerHelper.error(500, "InvalidFileContent", "Content of the retrieved file is not in binary format.");
    }

    let resultToReturn = {
      "fileName": fileName,
      "mediaType": mediaType,
      "signedContent": readySignatureFileResponse.responseData
    };

    return resultToReturn;
  } catch (e) {
    throw errorHandlerHelper.error(500, "FetchReadySignatureFileError", "An error has ocurred while fetching ready signature file from provider.", e);
  }
};