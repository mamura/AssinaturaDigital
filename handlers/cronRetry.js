"use strict";

const globals = require("../config/globals");
const responseHelper = require("../helpers/response");
const errorHandlerHelper = require("../helpers/errorHandler");
const requestHelper = require("../helpers/request");
const signaturesTable = require("../resources/tables/signatures");
const registeredReadySignaturesQueue = require("../resources/queues/registeredReadySignatures");
const pendingSignaturesQueue = require("../resources/queues/pendingSignatures");
const readyOrErroredSignaturesQueue = require("../resources/queues/readyOrErroredSignatures");
const providers = require("../providers");

const uuidRegex = new RegExp(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/i);
const LIMIT_REGISTERED_READY_QUEUE_OCCUPATION = 30;
const LIMIT_PENDING_SIGNATURES_QUEUE_OCCUPATION = 30;
const LIMIT_READY_OR_ERRORED_QUEUE_OCCUPATION = 30;

const FETCH_SINCE_LAST_MINUTES = 20; //20 minutes

const TIMEOUT_UNCOMPLETE_SIGNATURE_TRANSACTION_MINUTES = 5; //5 minutes  

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

    let promisesCronTasks = [
      {"cronTask": "reprocessNotStartedSignatureTransactions", "promise": reprocessNotStartedSignatureTransactions()},
      {"cronTask": "reprocessStartedButNotFinishedSignatureTransactions", "promise": reprocessStartedButNotFinishedSignatureTransactions()},
      {"cronTask": "reprocessNotNotifiedFinishedOrErroredSignatureTransaction", "promise": reprocessNotNotifiedFinishedOrErroredSignatureTransactions()},
      {"cronTask": "resolveNotProcessedSignatureTransactions", "promise": resolveNotProcessedSignatureTransactions()}
    ];

    let cronTasksExecutionResults = await Promise.all(promisesCronTasks.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Cron task ${pendingPromise.cronTask} successfully completed.`);
        return {
          "cronTask": pendingPromise.cronTask,
          "result": res
        };
      })
      .catch((e) => {
        console.warn(`An error has occurred while processing cron task ${pendingPromise.cronTask}.`, e);
        return {
          "cronTask": pendingPromise.cronTask,
          "result": e
        } 
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "ReprocessingTroubledSignatureRecordsError", "An unexpected error has ocurred while executing cron tasks for reprocessing troubled signature records.", e);
    });

    let promisesUpdateUnprocessable = [];

    cronTasksExecutionResults.forEach((cronTasksExecutionResult) => {
      console.log(`Entered into loop for cronTaskExecutionResult:  ${JSON.stringify(cronTasksExecutionResult || {})}`);
      let unprocessableToUpdate = 0;
      if (!(cronTasksExecutionResult instanceof Error) && cronTasksExecutionResult.result && !(cronTasksExecutionResult.result instanceof Error)) {
        (cronTasksExecutionResult.result.flaggedUnprocessable || []).forEach((flaggedUnprocessable) => {
          console.log(`Treating unprocessable record:  ${JSON.stringify(flaggedUnprocessable || {})}`);

          if (flaggedUnprocessable.record && flaggedUnprocessable.reason) {
            console.log(`Record eligible to be processed:  ${JSON.stringify(flaggedUnprocessable || {})}`);
            ++unprocessableToUpdate;
            let tableKey = {
              "requestId": flaggedUnprocessable.record.requestId
            };

            if (flaggedUnprocessable.record.signerIdentity) {
              tableKey.signerIdentity = flaggedUnprocessable.record.signerIdentity;
            }

            let conditions = {
              "expression": "sts <> :cond_sts AND requesterCallbackSts <> :cond_requesterCallbackSts ",
              "values": { 
                ":cond_sts": "SIGNED",
                ":cond_requesterCallbackSts": "NOTIFIED"
              }
            };

            let dataToPersist = {
              "sts": flaggedUnprocessable.reason
            };

            promisesUpdateUnprocessable.push({"requestId": tableKey.requestId, "promise": signaturesTable.update(tableKey, dataToPersist, conditions)});
          }
        });
        cronTasksExecutionResult.result.unprocessableToUpdate = unprocessableToUpdate;
      }
    });

    await Promise.all(promisesUpdateUnprocessable.map((pendingPromise) => {
      return pendingPromise.promise.then((res) => {
        console.info(`Update unprocessable record for requestId ${pendingPromise.requestId} successfully completed! Result details: `, res);
        return res;
      })
      .catch((e) => {
        console.error(`An error has occurred while updating unprocessable record for signature with requestId ${pendingPromise.requestId}. Error details: `, e);
        return e; 
      });
    })).then((results) => {
      return results;
    }).catch((e) => {
      throw errorHandlerHelper.error(500, "UpdateUnprocessableRecordsError", "An unexpected error has ocurred while executing tasks for updating unprocessable signature records.", e);
    });

    return responseHelper.asyncSuccess(lambdaContext.awsRequestId, null, cronTasksExecutionResults);
  } catch (e) {
    return responseHelper.asyncFailure(lambdaContext.awsRequestId, null, e);
  }
};

const reprocessNotStartedSignatureTransactions = () => {
  return new Promise(async (resolve, reject) => {
    try {
      //this is to avoid filling the PendingSignaturesQueue indefinitely in a situation in which provider is totally down and all signature requests are failing
      //kind of a throttling
      const limitRecordsToRetrieve = LIMIT_PENDING_SIGNATURES_QUEUE_OCCUPATION - (await pendingSignaturesQueue.getCurrentTotMessages());
  
      if (limitRecordsToRetrieve <= 0) {
        console.warn("Queue PendingSignaturesQueue is too busy now. Postponing reprocessing unfinished signature transaction for next cron execution....");
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      } 

      const elapsedTimeSeconds = 60;
      const sinceWhenSeconds = FETCH_SINCE_LAST_MINUTES * 60;
  
      let notStartedSignatureTransactionRecords = await signaturesTable.queryNotStartedYet(elapsedTimeSeconds, sinceWhenSeconds, limitRecordsToRetrieve, ["requestId", "signerIdentity", "provider", "signerAuthorizationExp", "unsignedDocument.kind", "unsignedDocument.correlationId", "requestOrigin.client", "sts"]);
  
      // Immediately return if there is no record with missing callback from provider
      if (!Array.isArray(notStartedSignatureTransactionRecords) || notStartedSignatureTransactionRecords.length === 0) {
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }
  
      let dataToQueue = [];
      let flaggedUnprocessable = [];
  
      //Iterates over each retrieved record
      notStartedSignatureTransactionRecords.forEach((notStartedSignatureRecord) => {
        try {
          //if for any reason the provider name is corrupted or inconsistent, do not proceed.
          if (!notStartedSignatureRecord.provider || globals.specs.enabledProviders.indexOf(notStartedSignatureRecord.provider) < 0) {
            console.warn(`Signature record with requestId ${notStartedSignatureRecord.requestId} has a invalid provider value: ${notStartedSignatureRecord.provider}.`);
            flaggedUnprocessable.push({
                "reason": "INVALID_PROVIDER",
                "record": notStartedSignatureRecord
            });
            return;
          }
  
          //otherwise, set the record to be reprocessed
          dataToQueue.push({
            "requestId": notStartedSignatureRecord.requestId, 
            "signerIdentity": notStartedSignatureRecord.signerIdentity, 
            "provider": notStartedSignatureRecord.provider, 
            "signerAuthorizationExp": notStartedSignatureRecord.signerAuthorizationExp, 
            "documentKind": notStartedSignatureRecord.unsignedDocument.kind, 
            "documentCorrelationId": notStartedSignatureRecord.unsignedDocument.correlationId, 
            "clientName": notStartedSignatureRecord.requestOrigin.client,
            "sts": notStartedSignatureRecord.sts
          });
        } catch (e) {
          console.warn(`An unexpected error has ocurred while treating not started signature transaction record with requestId ${notStartedSignatureRecord.requestId}`);
          flaggedUnprocessable.push({
            "reason": "REPROCESSING_NOT_STARTED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            "record": notStartedSignatureRecord
          });
        } 
      });

      let queueError = null;

      try {
        if (dataToQueue.length > 0) {
          let pendingSignautresQueueBatchResult = await pendingSignaturesQueue.sendMessageBatch(dataToQueue);
          if (pendingSignautresQueueBatchResult === false) {
            console.warn(`Not all pending signature records could be processed on bach operation over queue.`);
          }
        }
      } catch (e) {
        console.error(`An unexpected error has ocurred while trying to send message batch to pending signatures queue.`, e);
        queueError = errorHandlerHelper.error(500, "SendBatchPendingQueueError", "Could not send message batch to pending signatures queue.", e);
      }
      
      return resolve({
        "recordsFetched": notStartedSignatureTransactionRecords.length,
        "recordsProcessed": (!queueError ? dataToQueue.length : 0),
        "flaggedUnprocessable": flaggedUnprocessable,
        "errors": [queueError].filter((qErr) => {
          return (qErr instanceof Error);
        })
      });
    } catch (e) {
      console.error(`A failure has ocurrend while executing routine for reprocessing not started signature transactions.`, e);
      return reject(e);
    }
  });
};

const reprocessStartedButNotFinishedSignatureTransactions = () => {
  return new Promise(async (resolve, reject) => {
    try {
      //this is to avoid filling the RegisteredReadySignaturesQueue indefinitely in a situation in which provider is totally down and all signature requests are failing
      //kind of a throttling
      let limitRecordsToRetrieve = LIMIT_REGISTERED_READY_QUEUE_OCCUPATION - (await registeredReadySignaturesQueue.getCurrentTotMessages());

      if (limitRecordsToRetrieve <= 0) {
        console.warn("Queue RegisteredReadySignaturesQueue is too busy now. Postponing reprocessing unfinished signature transaction for next cron execution...");
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      } 

      const elapsedTimeSeconds = 60;
      const sinceWhenSeconds = FETCH_SINCE_LAST_MINUTES * 60;
  
      let startedButNotFinishedSignatureTransactionRecords = await signaturesTable.queryStartedButNotFinishedYet(elapsedTimeSeconds, sinceWhenSeconds, limitRecordsToRetrieve, ["requestId", "signerIdentity", "provider", "providerSignatureId", "signerAuthorizationExp", "unsignedDocument.kind", "unsignedDocument.correlationId", "requestOrigin.client", "sts", "createdAt"]);
  
      // Immediately return if there is no record retrieved
      if (!Array.isArray(startedButNotFinishedSignatureTransactionRecords) || startedButNotFinishedSignatureTransactionRecords.length === 0) {
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }
  
      let promisesCheckSignatureStatusRequests = [];
      let flaggedUnprocessable = [];
      let dataToPendingQueue = [];
  
      //Iterates over each retrieved record
      startedButNotFinishedSignatureTransactionRecords.forEach((startedButNotFinishedSignatureRecord) => {
        try {
          //if for any reason the provider name is corrupted or inconsistent, do not proceed.
          if (!startedButNotFinishedSignatureRecord.provider || globals.specs.enabledProviders.indexOf(startedButNotFinishedSignatureRecord.provider) < 0) {
            console.warn(`Signature record with requestId ${startedButNotFinishedSignatureRecord.requestId} has a invalid provider value: ${startedButNotFinishedSignatureRecord.provider}.`);
            flaggedUnprocessable.push({
                "reason": "INVALID_PROVIDER",
                "record": startedButNotFinishedSignatureRecord
            });
            return;
          }
          
          //if for any reason the provider signature ID is corrupted or inconsistent, do not proceed.
          if (!startedButNotFinishedSignatureRecord.providerSignatureId || !startedButNotFinishedSignatureRecord.providerSignatureId.match(uuidRegex)) {
            console.warn(`Signature record with requestId ${startedButNotFinishedSignatureRecord.requestId} has a invalid value for providerSignatureId property: ${startedButNotFinishedSignatureRecord.providerSignatureId}.`);
            flaggedUnprocessable.push({
                "reason": "INVALID_PROVIDER_SIGNATURE_ID",
                "record": startedButNotFinishedSignatureRecord
            });
            return;
          }

          if (["UPLOADED_TO_PROVIDER", "READY_TO_DOWNLOAD"].indexOf(startedButNotFinishedSignatureRecord.sts) === -1) { //transaction has started, but unsigned file has not been uploaded to provider yet
            dataToPendingQueue.push({
              "requestId": startedButNotFinishedSignatureRecord.requestId, 
              "signerIdentity": startedButNotFinishedSignatureRecord.signerIdentity, 
              "provider": startedButNotFinishedSignatureRecord.provider, 
              "signerAuthorizationExp": startedButNotFinishedSignatureRecord.signerAuthorizationExp, 
              "documentKind": startedButNotFinishedSignatureRecord.unsignedDocument.kind, 
              "documentCorrelationId": startedButNotFinishedSignatureRecord.unsignedDocument.correlationId, 
              "clientName": startedButNotFinishedSignatureRecord.requestOrigin.client,
              "sts": startedButNotFinishedSignatureRecord.sts
            });
            return;
          }
  
          //otherwise, unsigned document might been uploaded to provider. Then, set the promise to check signature record status at provider
          let provider = providers.loadProvider(startedButNotFinishedSignatureRecord.provider);
          
          const pomisifyCheckSignatureStatus = (provider, providerSignatureId) => {
            return new Promise(async (resolve, reject) => {
              try {
                let result = await provider.checkSignatureTransactionStatus(providerSignatureId);
                resolve(result);
              } catch (e) {
                reject(e);
              }
            });
          };

          promisesCheckSignatureStatusRequests.push({
            "providerSignatureId": startedButNotFinishedSignatureRecord.providerSignatureId,
            "promise": pomisifyCheckSignatureStatus(provider, startedButNotFinishedSignatureRecord.providerSignatureId) 
          });
        } catch (e) {
          console.warn(`An unexpected error has ocurred while trying to check status for signature with requestId ${startedButNotFinishedSignatureRecord.requestId}`);
          flaggedUnprocessable.push({
            "reason": "REPROCESSING_UNFINISHED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            "record": startedButNotFinishedSignatureRecord
          });
        } 
      });

      let queuePendingError = null;

      //firstly, send all pending signatures to pending queue
      try {
        if (dataToPendingQueue.length > 0) {
          let pendingSignautresQueueBatchResult = await pendingSignaturesQueue.sendMessageBatch(dataToPendingQueue);
          if (pendingSignautresQueueBatchResult === false) {
            console.warn(`Not all pending signature records could be processed on bach operation over queue.`);
          }
        }
      } catch (e) {
        console.error(`An unexpected error has ocurred while trying to send message batch to pending signatures queue.`, e);
        queuePendingError = errorHandlerHelper.error(500, "SendBatchPendingQueueError", "Could not send message batch to pending signatures queue.", e);
      }
  
      //then, await for all promises tasks to check started signature status to return results
      let promisesResults = await Promise.all(promisesCheckSignatureStatusRequests.map((pendingPromise) => {
                                                  return pendingPromise.promise.catch((e) => {
                                                    let erroredSignatureRecord = startedButNotFinishedSignatureTransactionRecords.find((signatureRecordWithMissingCallback) => {
                                                      return (pendingPromise.providerSignatureId === signatureRecordWithMissingCallback.providerSignatureId);
                                                    });
  
                                                    console.warn(`Status checking for signature record with requestId ${erroredSignatureRecord.requestId} has failed.`, e);
  
                                                    if (!(e.statusCode && e.statusCode >= 500)) { //unrecoverable errors. Errors with status code >= 500 will be reprocessed again in next cron execution
                                                      flaggedUnprocessable.push({
                                                        "reason": "CHECK_SIGNATURE_REQUEST_ERROR",
                                                        "record": erroredSignatureRecord
                                                      });
                                                    }
  
                                                    return null; 
                                                  });
                                              })).then((results) => {
                                                return results;
                                              }).catch((e) => {
                                                //in this case, all set of processable records will be retried in next cron execution
                                                return errorHandlerHelper.error(500, "CheckSignatureStatusError", "An unexpected error has ocurred while processing promises for checking signature transaction status.", e);
                                              });
      
      if (promisesResults instanceof Error) {
        throw promisesResults;
      }
      
      let dataToRegisteredReadyQueue = [];
  
      //for each check result...
      promisesResults.forEach((promiseSignatureTransactionStatusResult) => {
        let currentSignatureRecord = null;

        //take the corresponding signature record previously retrieved from DB that matchs with the current result being inspected
        if (promiseSignatureTransactionStatusResult !== null && !(promiseSignatureTransactionStatusResult instanceof Error)) {
          currentSignatureRecord = startedButNotFinishedSignatureTransactionRecords.find((signatureRecordWithMissingCallback) => {
            return (promiseSignatureTransactionStatusResult.providerSignatureId || "").trim() === signatureRecordWithMissingCallback.providerSignatureId;
          });
        };

        //if a corresponding record has been found...
        if (currentSignatureRecord) {
          //verify the signature status
          let returnedStatus = (promiseSignatureTransactionStatusResult.document || {}).signatureStatus;
          switch (returnedStatus) {
            case "SIGNED":
              //if signed, then take it to be put on queue to be processed later on
              dataToRegisteredReadyQueue.push({
                "requestId": currentSignatureRecord.requestId,
                "providerSignatureId": currentSignatureRecord.providerSignatureId,
                "readySignatureFileUrl": promiseSignatureTransactionStatusResult.document.signedFileUrl,
                "clientName": currentSignatureRecord.requestOrigin.client,
                "documentKind": currentSignatureRecord.unsignedDocument.kind,
                "documentCorrelationId": currentSignatureRecord.unsignedDocument.correlationId
              });
              break;
            case "WAITING":
              //if signature is awaiting completion...
              if ((Date.now() - currentSignatureRecord.createdAt) >= (TIMEOUT_UNCOMPLETE_SIGNATURE_TRANSACTION_MINUTES * 60 * 1000)) { // if it has reached configured time out execution, flag it as unprocessable
                console.warn(`Signature for requestId ${currentSignatureRecord.requestId} is not ready yet and has reached transaction timeout execution (${TIMEOUT_UNCOMPLETE_SIGNATURE_TRANSACTION_MINUTES} minutes). Flagging it as unprocessable.`);
                flaggedUnprocessable.push({
                  "reason": "SIGNATURE_TRANSACTION_TIMED_OUT",
                  "record": currentSignatureRecord
                });
              } else { // otherwise, just ignore it
                console.info(`Signature for requestId ${currentSignatureRecord.requestId} is not ready yet. It will be retried on next cron execution.`);
              }
              break;
            case "ERROR":
              console.warn(`Signature for requestId ${currentSignatureRecord.requestId} has failed.`);
              flaggedUnprocessable.push({
                "reason": "SIGNATURE_ERROR",
                "record": currentSignatureRecord
              });
              break;
            default:
              console.warn(`Signature status check for requestId ${currentSignatureRecord.requestId} has returned an unknown status: ${returnedStatus}.`);
              flaggedUnprocessable.push({
                "reason": "UNKNOWN_SIGNATURE_STATUS",
                "record": currentSignatureRecord
              });
          };
        }
      });

      let queueRegisteredReadyError = null;

      try {
        if (dataToRegisteredReadyQueue.length > 0) {
          let registerReadySignautresQueueBatchResult = await registeredReadySignaturesQueue.sendMessageBatch(dataToRegisteredReadyQueue);
          if (registerReadySignautresQueueBatchResult === false) {
            console.warn(`Not all ready signature records could be processed on bach operation over queue.`);
          }
        }
      } catch (e) {
        console.error(`An unexpected error has ocurred while trying to send message batch to registered ready signatures queue.`, e);
        queueRegisteredReadyError = errorHandlerHelper.error(500, "SendBatchRegisteredREadyQueueError", "Could not send message batch to registered ready signatures queue.", e);
      }
      
      return resolve({
        "recordsFetched": startedButNotFinishedSignatureTransactionRecords.length,
        "recordsProcessed": (!queuePendingError ? dataToPendingQueue.length : 0) + (!queueRegisteredReadyError ? dataToRegisteredReadyQueue.length : 0),
        "flaggedUnprocessable": flaggedUnprocessable,
        "errors": [queuePendingError, queueRegisteredReadyError].filter((qErr) => {
          return (qErr instanceof Error);
        })
      });
    } catch (e) {
      console.error(`A failure has ocurrend while executing routine for reprocessing started but unfinished signature transactions.`, e);
      return reject(e);
    }
  });
};

const reprocessNotNotifiedFinishedOrErroredSignatureTransactions = () => {
  return new Promise(async (resolve, reject) => {
    try {
      //this is to avoid filling the ReadyOrErroredSignaturesQueue indefinitely in a situation in which provider is totally down and all signature requests are failing
      //kind of a throttling
      const limitRecordsToRetrieve = LIMIT_READY_OR_ERRORED_QUEUE_OCCUPATION - (await readyOrErroredSignaturesQueue.getCurrentTotMessages());
  
      if (limitRecordsToRetrieve <= 0) {
        console.warn("Queue ReadyOrErroredSignaturesQueue is too busy now. Postponing reprocessing not notified finished signature transaction for next cron execution....");
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }

      const elapsedTimeSeconds = 60;
      const sinceWhenSeconds = FETCH_SINCE_LAST_MINUTES * 60;
  
      let notNotifiedFinishedOrErroredSignatureTransactionRecords = await signaturesTable.queryFinishedOrErroredNotNotifiedYet(elapsedTimeSeconds, sinceWhenSeconds, limitRecordsToRetrieve, ["requestId", "unsignedDocument.kind", "unsignedDocument.correlationId", "requestOrigin.client", "sts", "requesterCallbackSts"]);
  
      // Immediately return if there is no record
      if (!Array.isArray(notNotifiedFinishedOrErroredSignatureTransactionRecords) || notNotifiedFinishedOrErroredSignatureTransactionRecords.length === 0) {
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }
  
      let dataToQueue = [];
      let flaggedUnprocessable = [];
  
      //Iterates over each retrieved record
      notNotifiedFinishedOrErroredSignatureTransactionRecords.forEach((notNotifiedFinishedOrErroredSignatureTransactionRecord) => {
        try {
          let itemToQueue = {
            "requestId": notNotifiedFinishedOrErroredSignatureTransactionRecord.requestId, 
            "documentKind": notNotifiedFinishedOrErroredSignatureTransactionRecord.unsignedDocument.kind, 
            "documentCorrelationId": notNotifiedFinishedOrErroredSignatureTransactionRecord.unsignedDocument.correlationId, 
            "clientName": notNotifiedFinishedOrErroredSignatureTransactionRecord.requestOrigin.client
          };

          if (!(["SIGNED", "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.sts) >= 0 && ["AWAITING_SIGNATURE", "NOTIFICATION_ERROR"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts) >= 0)) {
            itemToQueue.errorReason = (["AWAITING_SIGNATURE", "NOTIFICATION_ERROR"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts) >= 0) ? notNotifiedFinishedOrErroredSignatureTransactionRecord.sts : notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts
          }

          dataToQueue.push(itemToQueue);
        } catch (e) {
          console.warn(`An unexpected error has ocurred while treating not notified finished or errored transaction record with requestId ${notNotifiedFinishedOrErroredSignatureTransactionRecord.requestId}`);
          flaggedUnprocessable.push({
            "reason": "REPROCESSING_NOT_NOTIFIED_FINISHED_OR_ERRORED_TRANSACTION_EXECUTION_ERROR",
            "record": notNotifiedFinishedOrErroredSignatureTransactionRecord
          });
        } 
      });

      let queueError = null;

      try {
        if (dataToQueue.length > 0) {
          let readyOrErroredSignaturesQueueBatchResult = await readyOrErroredSignaturesQueue.sendMessageBatch(dataToQueue);
          if (readyOrErroredSignaturesQueueBatchResult === false) {
            console.warn(`Not all not notified ready or errored signature records could be processed on bach operation over queue.`);
          }
        }
      } catch (e) {
        console.error(`An unexpected error has ocurred while trying to send message batch to ready or errored signature queue.`, e);
        queueError = errorHandlerHelper.error(500, "SendBatchReadyOrErroredQueueError", "Could not send message batch to ready or errored signatures queue.", e);
      }
      
      return resolve({
        "recordsFetched": notNotifiedFinishedOrErroredSignatureTransactionRecords.length,
        "recordsProcessed": (!queueError ? dataToQueue.length : 0),
        "flaggedUnprocessable": flaggedUnprocessable,
        "errors": [queueError].filter((qErr) => {
          return (qErr instanceof Error);
        })
      });
    } catch (e) {
      console.error(`A failure has ocurrend while executing routine for reprocessing not notified ready or errored signature transactions.`, e);
      return reject(e);
    }
  });
};

const resolveNotProcessedSignatureTransactions = () => {
  return new Promise(async (resolve, reject) => {
    try {
      //this is to avoid filling the ReadyOrErroredSignaturesQueue indefinitely in a situation in which provider is totally down and all signature requests are failing
      //kind of a throttling
      const limitRecordsToRetrieve = LIMIT_READY_OR_ERRORED_QUEUE_OCCUPATION - (await readyOrErroredSignaturesQueue.getCurrentTotMessages());
  
      if (limitRecordsToRetrieve <= 0) {
        console.warn("Queue ReadyOrErroredSignaturesQueue is too busy now. Postponing resolving not processed signature transaction for next cron execution....");
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }

      const sinceWhenSeconds = (FETCH_SINCE_LAST_MINUTES - 1) * 60;
  
      let notProcessedSignatureTransactionRecords = await signaturesTable.queryNotProcessed(sinceWhenSeconds, limitRecordsToRetrieve, ["requestId", "unsignedDocument.kind", "unsignedDocument.correlationId", "requestOrigin.client", "sts", "requesterCallbackSts", "createdAt"]);
  
      // Immediately return if there is no record
      if (!Array.isArray(notProcessedSignatureTransactionRecords) || notProcessedSignatureTransactionRecords.length === 0) {
        return resolve({
          "recordsFetched": 0,
          "recordsProcessed":  0,
          "flaggedUnprocessable": [],
          "errors": []
        });
      }
  
      let dataToQueue = [];
      let flaggedUnprocessable = [];
  
      //Iterates over each retrieved record
      notProcessedSignatureTransactionRecords.forEach((notProcessedSignatureTransactionRecord) => {
        try {
          /*flaggedUnprocessable.push({
            "reason": "NOT_PROCESSED_TIMELY",
            "record": notProcessedSignatureTransactionRecord
          });*/

          let itemToQueue = {
            "requestId": notProcessedSignatureTransactionRecord.requestId, 
            "documentKind": notProcessedSignatureTransactionRecord.unsignedDocument.kind, 
            "documentCorrelationId": notProcessedSignatureTransactionRecord.unsignedDocument.correlationId, 
            "clientName": notProcessedSignatureTransactionRecord.requestOrigin.client,
            "errorReason": "NOT_PROCESSED_TIMELY"
          };

          /*if (!(["SIGNED", "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.sts) >= 0 && ["AWAITING_SIGNATURE", "NOTIFICATION_ERROR"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts) >= 0)) {
            itemToQueue.errorReason = (["AWAITING_SIGNATURE", "NOTIFICATION_ERROR"].indexOf(notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts) >= 0) ? notNotifiedFinishedOrErroredSignatureTransactionRecord.sts : notNotifiedFinishedOrErroredSignatureTransactionRecord.requesterCallbackSts
          }*/

          dataToQueue.push(itemToQueue);
        } catch (e) {
          /*console.warn(`An unexpected error has ocurred while treating not notified finished or errored transaction record with requestId ${notNotifiedFinishedOrErroredSignatureTransactionRecord.requestId}`);
          flaggedUnprocessable.push({
            "reason": "REPROCESSING_NOT_NOTIFIED_FINISHED_OR_ERRORED_TRANSACTION_EXECUTION_ERROR",
            "record": notNotifiedFinishedOrErroredSignatureTransactionRecord
          });*/
        } 
      });

      let queueError = null;

      try {
        if (dataToQueue.length > 0) {
          let readyOrErroredSignaturesQueueBatchResult = await readyOrErroredSignaturesQueue.sendMessageBatch(dataToQueue);
          if (readyOrErroredSignaturesQueueBatchResult === false) {
            console.warn(`Not all not processed signature records could be processed on bach operation over queue.`);
          }
        }
      } catch (e) {
        console.error(`An unexpected error has ocurred while trying to send message batch to ready or errored signature queue.`, e);
        queueError = errorHandlerHelper.error(500, "SendBatchReadyOrErroredQueueError", "Could not send message batch to ready or errored signatures queue.", e);
      }
      
      return resolve({
        "recordsFetched": notProcessedSignatureTransactionRecords.length,
        "recordsProcessed": (!queueError ? dataToQueue.length : 0),
        "flaggedUnprocessable": flaggedUnprocessable,
        "errors": [queueError].filter((qErr) => {
          return (qErr instanceof Error);
        })
      });
    } catch (e) {
      console.error(`A failure has ocurrend while executing routine for resolving not processed signature transactions.`, e);
      return reject(e);
    }
  });
};
