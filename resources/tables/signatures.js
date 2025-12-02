"use strict";

const dynamoDBHelper = require("../../helpers/dynamoDB");
const errorHandlerHelper = require("../../helpers/errorHandler");
const generalTableUtilities = require("./generalUtilities");

module.exports.get = async(tableKey, attributesToProject) => {
    let dbParams = {
        "Key": {
            "requestId": tableKey.requestId,
            "signerIdentity": tableKey.signerIdentity
        }
    };

    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    if (!dbParams.Key.signerIdentity) {
        delete dbParams.Key.signerIdentity;
    }

    try {
        let result = await dynamoDBHelper.get(process.env.RSRC_SIGNATURES_TABLE, dbParams);
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to retrieve item from signatures table.", e);
    }
};

module.exports.put = async (tableKey, data, requestContextIdentity) => {
    const now = new Date();

    let dbParams = {
        "Item": {
            "requestId": tableKey.requestId,
            "shortId": tableKey.shortId,
            "signerIdentity": tableKey.signerIdentity,
            "provider": data.provider,
            "environment": data.environment || null,
            "sts": data.sts,
            "stsUpdatedAt": (data.sts) ? now.getTime() : null,
            "signerAuthorization": data.signerAuthorization,
            "signerAuthorizationExp": data.signerAuthorizationExp,
            "signerCertificateAlias": data.signerCertificateAlias || null,
            "unsignedDocument": data.document,
            "signedDocument": null,
            "requesterNotificationCallback": data.callbackUrl || null,
            "requesterCallbackSts": "AWAITING_SIGNATURE",
            "requesterCallbackStsUpdatedAt": now.getTime(),
            "providerSignatureId": null,
            "signatureType": null,
            "signaturePolicy": null,
            "signatureHashAlgorithm": null,
            "signatureDocumentSource": null,
            "signatureAttributes": data.signatureAttributes,
            "signatureSettingsProfileId": null, 
            "tsaHashAlgorithm": null,
            "tsaServerId": null,
            "serviceNotificationCallback": data.serviceNotificationCallback || null,
            "checkCounter": 0,
            "lastCheckAt": null,
            "lastCheckRequestId": null,
            "replacementFor": data.revoke || null,
            "replacedBy": null,
            "adminOnErrorLasNotifiedAt": null,
            "adminOnErrorNotificationCount": 0,
            ...(await generalTableUtilities.formatRequestIdentityMetadata(requestContextIdentity))
        },
        "ConditionExpression": "attribute_not_exists(requestId) and attribute_not_exists(shortId)"
    };
  
    try {
        await dynamoDBHelper.put(process.env.RSRC_SIGNATURES_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to persist data into signatures table.", e);
    }
};

module.exports.update = async (tableKey, data, conditions, options) => {
    options = options || {};

    let dbParams = {
        "Key": {
            "requestId": tableKey.requestId
        },
        "UpdateExpression": "SET ",
        "ExpressionAttributeValues": {},
        "ReturnValues": options.returnValues || "NONE"
    };

    if (tableKey.signerIdentity) {
        dbParams.Key.signerIdentity = tableKey.signerIdentity;
    }

    if (conditions) {
        if (conditions.expression) {
            dbParams.ConditionExpression = conditions.expression;
        }
    
        if (conditions.values) {
            dbParams.ExpressionAttributeValues = {
            ...dbParams.ExpressionAttributeValues,
            ...conditions.values
            };
        }
    }

    const now = new Date();

    const updatableFields = [
        "sts",
        "signedDocument",
        "requesterCallbackSts",
        "providerSignatureId",
        "signerCertificateAlias",
        "signatureType",
        "signaturePolicy",
        "signatureHashAlgorithm",
        "tsaHashAlgorithm",
        "serviceNotificationCallback",
        "tsaServerId",
        "signatureDocumentSource",
        "signerAuthorization",
        "signerAuthorizationExp",
        "replacedBy",
        "signatureSettingsProfileId",
        "adminOnErrorLasNotifiedAt",
        "adminOnErrorNotificationCount"
    ];

    for (let key in data) {
        if (data.hasOwnProperty(key)) {
            if (updatableFields.indexOf(key) === -1) {
                throw errorHandlerHelper.error(500, "DatabaseValidationError", `Field ${key} is not in the updatable field list for table ${process.env.RSRC_SIGNATURES_TABLE}.`);
            }

            dbParams.UpdateExpression += ` ${key} = :new_${key},`;
            dbParams.ExpressionAttributeValues[`:new_${key}`] = data[key];

            if (key === "sts" || key === "requesterCallbackSts") {
                dbParams.UpdateExpression += ` ${key}UpdatedAt = :new_${key}UpdatedAt,`;
                dbParams.ExpressionAttributeValues[`:new_${key}UpdatedAt`] = now.getTime();
            }
        }
    }

    try {
        let result = await dynamoDBHelper.update(process.env.RSRC_SIGNATURES_TABLE, dbParams);
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to update signature data in signatures table.", e);
    }
};

module.exports.queryByRequestId = async (requestId, attributesToProject) => {
    let dbParams = {
        "KeyConditionExpression": "requestId = :requestId",
        "ExpressionAttributeValues": {
            ":requestId": requestId
        }
    };

    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    try {
        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams);
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table by requestId.", e);
    }
};

module.exports.queryByRequestIds = async (requestIds, attributesToProject) => {
    try {
        const newQueryByRequestIdPromise = (requestId, attributesToProject) => {
            return new Promise(async (resolve, reject) => {
                try {
                    let result = await module.exports.queryByRequestId(requestId, attributesToProject);
                    return resolve(result);
                } catch (e) {
                    return reject(e);
                }
            });
        };
    
        requestIds = requestIds || [];
    
        let queryByIdPromises = [];
    
        requestIds.forEach((reqId) => {
            queryByIdPromises.push({
                "requestId": reqId,
                "promise": newQueryByRequestIdPromise(reqId, attributesToProject)
            });
        });

        let results = await Promise.all(queryByIdPromises.map((pendingPromise) => {
            return pendingPromise.promise.then((res) => {
              console.info(`Record for signature with requestId ${pendingPromise.requestId} successfully retrieved!`, res);
              return Array.isArray(res) && res.length === 1 ? res[0] : res;
            })
            .catch((e) => {
              console.error(`An error has occurred while retrieving record for signature with requestId ${pendingPromise.requestId}. Error details: `, e);
              return e; 
            });
          })).then((results) => {
            return results;
          }).catch((e) => {
            throw errorHandlerHelper.error(500, "UpdateUnprocessableRecordsError", "An unexpected error has ocurred while executing tasks for updating unprocessable signature records.", e);
          });

        if (results instanceof Error) {
            throw results;
        }

        return results || [];
        
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table by request Ids.", e);
    }
};

module.exports.queryByShortId = async (shortId, attributesToProject) => {
    let dbParams = {
        "IndexName": "signatureShortIdIndex",
        "KeyConditionExpression": "shortId = :cond_shortId",
        "ExpressionAttributeValues": {
            ":cond_shortId": shortId
        }
    };

    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    try {
        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams);
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table by secondary index shortId.", e);
    }
};

module.exports.queryNotStartedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    try {
        let now = Date.now();

        let promisesQueryIndexPerSts = [];

        const notStartedStates = [
            "SIGNER_AUTH_EXPIRED",
            "SIGNER_AUTH_FAILED",
            "PENDING", 
            "PROVIDER_START_SIGNATURE_TRANSACTION_ERROR",
            "PROVIDER_ERROR"
        ];

        let pageSizePerStatus = Math.ceil(((pageSize || 100) / notStartedStates.length) * (notStartedStates.length / 2)); //multiplied by a factor (number of states divided by 2) to rise chances of fetching the more records it can at each status
        waitingSeconds = waitingSeconds || 30;
        sinceWhenSeconds = sinceWhenSeconds || (60 * 60);

        notStartedStates.forEach((sts) => {
            let dbParams = {
                "IndexName": "signatureStsAndStsUpdatedAtIndex",
                "KeyConditionExpression": "sts = :cond_sts " + //ensure that document is indeed not signed yet
                                            " AND stsUpdatedAt BETWEEN :cond_stsUpdatedAt1 AND  :cond_stsUpdatedAt2 ", //elapsed time
                "FilterExpression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " + //if it does not have providerSignatureId yet (it is NULL), then signature transaction did not started
                                        " AND requesterCallbackSts = :cond_requesterCallbackSts ", //requester callback stage must be at awaiting signature
                                        //" AND (attribute_not_exists(replacedBy) OR attribute_type(replacedBy, :cond_attType_replacedBy)) ", //the signature was not revoked
                "ExpressionAttributeValues": {
                    ":cond_attType_providerSignatureId" : "NULL",
                    ":cond_sts": sts,
                    ":cond_requesterCallbackSts": "AWAITING_SIGNATURE",
                    ":cond_stsUpdatedAt1": now - (sinceWhenSeconds * 1000),
                    ":cond_stsUpdatedAt2": now - (waitingSeconds * 1000)
                    //":cond_attType_replacedBy": "NULL"
                }
            };

            if (sinceWhenSeconds !== null) {
                dbParams.FilterExpression += " AND createdAt >= :createdAt ";
                dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
            }

            if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
                dbParams["ProjectionExpression"] = attributesToProject.join(",")
            }

            let promisifyQuery = () => {
                return new Promise(async (resolve, reject) => {
                    try {
                        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams, pageSizePerStatus);
                        return resolve(result);
                    } catch (e) {
                        return reject(e);
                    }
                });
            };
            promisesQueryIndexPerSts.push({"sts": sts, "index": dbParams.IndexName, "promise": promisifyQuery()});
        });

        let results = [];
        let errors = [];

        await Promise.all(promisesQueryIndexPerSts.map((pendingPromise) => {
            return pendingPromise.promise.then((res) => {
            //console.info(`queryNotStartedYet: query over index ${pendingPromise.index} with sts = ${pendingPromise.sts} successfully completed.`);
            results = results.concat(res || []);
            })
            .catch((e) => {
                console.warn(`queryNotStartedYet: an error has occurred while querying index ${pendingPromise.index} with sts = ${pendingPromise.sts}.`, e);
                errors.push(e);
            });
        })).catch((e) => {
            throw errorHandlerHelper.error(500, "QueryNotStartedSignatureTransactionsError", "An unexpected error has ocurred while querying not started signature transactions.", e);
        });

        if (errors.length > 0) {
            throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table for fetching records with not started signature transactions.", (errors.length === 1) ? errors[0] : errors);
        }

        return sortResults(results, "stsUpdatedAt", 1).slice(0, pageSize);
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode || 500, "QueryNotStartedYetError", "Unexpected exception while performing query for retrieving not started yet signature transactions.", e);
    }
};

//do not use this never more
module.exports.scanNotStartedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    let now = Date.now();

    let dbParams = {
        "FilterExpression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " + //if it does not have providerSignatureId yet (it is NULL), then signature transaction did not started
                                " AND sts <> :cond_sts " + //just to ensure that document is indeed not signed yet
                                " AND requesterCallbackSts = :cond_requesterCallbackSts " + //requester callback stage must be at awaiting signature
                                " AND stsUpdatedAt < :cond_stsUpdatedAt ", //elapsed time
        "ExpressionAttributeValues": {
            ":cond_attType_providerSignatureId" : "NULL",
            ":cond_sts": "SIGNED",
            ":cond_requesterCallbackSts": "AWAITING_SIGNATURE",
            ":cond_stsUpdatedAt": now - ((waitingSeconds || 30) * 1000)
        }
    };

    if (sinceWhenSeconds !== null) {
        dbParams.FilterExpression += " AND createdAt >= :createdAt ";
        dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
    }


    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    try {
        let result = await dynamoDBHelper.scan(process.env.RSRC_SIGNATURES_TABLE, dbParams, (pageSize || 100));
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to scan signature table for fetching records with not started signature transactions.", e);
    }
};

module.exports.queryStartedButNotFinishedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    try {
        let now = Date.now();

        let promisesQueryIndexPerSts = [];

        const startedButNotFinishedStates = [
            "UPLOAD_TO_PROVIDER_FAILED",
            "DOWNLOAD_FROM_PROVIDER_FAILED",
            "PROVIDER_TRANSACTION_STARTED",
            "UPLOADED_TO_PROVIDER",
            "READY_TO_DOWNLOAD"
        ];

        let pageSizePerStatus = Math.ceil(((pageSize || 100) / startedButNotFinishedStates.length) * (startedButNotFinishedStates.length / 2)); //multiplied by a factor (number of states divided by 2) to rise chances of fetching the more records it can at each status
        waitingSeconds = waitingSeconds || 30;
        sinceWhenSeconds = sinceWhenSeconds || (60 * 60);

        startedButNotFinishedStates.forEach((sts) => {
            let dbParams = {
                "IndexName": "signatureStsAndStsUpdatedAtIndex",
                "KeyConditionExpression": "sts = :cond_sts " + //ensure that document is indeed not signed yet
                                            " AND stsUpdatedAt BETWEEN :cond_stsUpdatedAt1 AND  :cond_stsUpdatedAt2 ", //elapsed time
                "FilterExpression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " + //if it has a providerSignatureId (it is an string... 
                                        " AND size(providerSignatureId) = :cond_size_providerSignatureId " + //... and it is filled (has a length of a valid UUID), so signature transaction has started
                                        " AND requesterCallbackSts = :cond_requesterCallbackSts ", //requester callback stage must be at awaiting signature
                                        //" AND (attribute_not_exists(replacedBy) OR attribute_type(replacedBy, :cond_attType_replacedBy)) ", //the signature was not revoked
                "ExpressionAttributeValues": {
                    ":cond_attType_providerSignatureId" : "S",
                    ":cond_size_providerSignatureId" : 36,
                    ":cond_sts": sts,
                    ":cond_requesterCallbackSts": "AWAITING_SIGNATURE",
                    ":cond_stsUpdatedAt1": now - (sinceWhenSeconds * 1000),
                    ":cond_stsUpdatedAt2": now - (waitingSeconds * 1000)
                    //":cond_attType_replacedBy": "NULL"
                }
            };
        
            if (sinceWhenSeconds !== null) {
                dbParams.FilterExpression += " AND createdAt >= :createdAt ";
                dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
            }
        
            if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
                dbParams["ProjectionExpression"] = attributesToProject.join(",")
            }

            let promisifyQuery = () => {
                return new Promise(async (resolve, reject) => {
                    try {
                        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams, pageSizePerStatus);
                        return resolve(result);
                    } catch (e) {
                        return reject(e);
                    }
                });
            };
            promisesQueryIndexPerSts.push({"sts": sts, "index": dbParams.IndexName, "promise": promisifyQuery()});
        });

        let results = [];
        let errors = [];

        await Promise.all(promisesQueryIndexPerSts.map((pendingPromise) => {
            return pendingPromise.promise.then((res) => {
            //console.info(`queryStartedButNotFinishedYet: query over index ${pendingPromise.index} with sts = ${pendingPromise.sts} successfully completed.`);
            results = results.concat(res || []);
            })
            .catch((e) => {
                console.warn(`queryStartedButNotFinishedYet: an error has occurred while querying index ${pendingPromise.index} with sts = ${pendingPromise.sts}.`, e);
                errors.push(e);
            });
        })).catch((e) => {
            throw errorHandlerHelper.error(500, "QueryNotStartedSignatureTransactionsError", "An unexpected error has ocurred while querying not started signature transactions.", e);
        });

        if (errors.length > 0) {
            console.log("errors", JSON.stringify(erros));
            throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table for fetching records with started but not finished signature transactions.", (errors.length === 1) ? errors[0] : errors);
        }

        return sortResults(results, "stsUpdatedAt", 1).slice(0, pageSize);
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode || 500, "QueryStartedButNotFinishedYetError", "Unexpected exception while performing query for retrieving started but not finished yet signature transactions.", e);
    }
};

//do not use this never more
module.exports.scanStartedButNotFinishedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    let now = Date.now();

    let dbParams = {
        "FilterExpression": "attribute_type(providerSignatureId, :cond_attType_providerSignatureId) " + //if it has a providerSignatureId (it is an string... 
                                " AND size(providerSignatureId) = :cond_size_providerSignatureId " + //... and it is filled (has a length of a valid UUID), so signature transaction has stared
                                " AND sts <> :cond_sts " + //just to ensure that document is indeed not signed yet
                                " AND requesterCallbackSts = :cond_requesterCallbackSts " + //requester callback stage must be at awaiting signature
                                " AND stsUpdatedAt < :cond_stsUpdatedAt ",
        "ExpressionAttributeValues": {
            ":cond_attType_providerSignatureId" : "S",
            ":cond_size_providerSignatureId" : 36,
            ":cond_sts": "SIGNED",
            ":cond_requesterCallbackSts": "AWAITING_SIGNATURE",
            ":cond_stsUpdatedAt": now - ((waitingSeconds || 30) * 1000)
        }
    };

    if (sinceWhenSeconds !== null) {
        dbParams.FilterExpression += " AND createdAt >= :createdAt ";
        dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
    }

    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    try {
        let result = await dynamoDBHelper.scan(process.env.RSRC_SIGNATURES_TABLE, dbParams, (pageSize || 100));
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to scan signature table for fetching records with unfineshed signature transaction.", e);
    }
};

module.exports.queryFinishedOrErroredNotNotifiedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    try {
        let now = Date.now();

        let promisesQueryIndexPerSts = [];

        const finishedOrErroredNotNotifiedStates = [
            "SIGNED",
            "READY_QUEUE_FAILED", //kept for legacy reasons. This status has been replaced by READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED
            "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED",
            "MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR",
            "PRECONDITION_ERROR", //kept for legacy reasons. This status has been replaced by MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR
            "UNSIGNED_DOCUMENT_UNCOMPRESSION_ERROR",
            "PROVIDER_SIGNATURE_ID_INCONSISTENCY",
            "INDETERMINISTIC_RECORD_ERROR",
            "INVALID_PROVIDER",
            "REPROCESSING_NOT_STARTED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            "INVALID_PROVIDER_SIGNATURE_ID",
            "REPROCESSING_UNFINISHED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            "CHECK_SIGNATURE_REQUEST_ERROR",
            "SIGNATURE_ERROR",
            "UNKNOWN_SIGNATURE_STATUS",
            "SIGNATURE_TRANSACTION_TIMED_OUT",
            "READY_SIGNATURE_FILE_URL_ERROR",
            "REPROCESSING_NOT_NOTIFIED_FINISHED_OR_ERRORED_TRANSACTION_EXECUTION_ERROR"
        ];

        let pageSizePerStatus = Math.ceil(((pageSize || 100) / finishedOrErroredNotNotifiedStates.length) * (finishedOrErroredNotNotifiedStates.length / 2)); //multiplied by a factor (number of states divided by 2) to rise chances of fetching the more records it can at each status
        waitingSeconds = waitingSeconds || 30;
        sinceWhenSeconds = sinceWhenSeconds || (60 * 60);

        finishedOrErroredNotNotifiedStates.forEach((sts) => {   
            let dbParams = {
                "IndexName": "signatureStsAndStsUpdatedAtIndex",
                "KeyConditionExpression": "sts = :cond_sts " + 
                                            " AND stsUpdatedAt BETWEEN :cond_stsUpdatedAt1 AND  :cond_stsUpdatedAt2 ", //elapsed time
                "FilterExpression": "(requesterCallbackSts <> :cond_requesterCallbackSts1 AND requesterCallbackSts <> :cond_requesterCallbackSts2 AND requesterCallbackSts <> :cond_requesterCallbackSts3 AND requesterCallbackSts <> :cond_requesterCallbackSts4 AND requesterCallbackSts <> :cond_requesterCallbackSts5 AND requesterCallbackSts <> :cond_requesterCallbackSts6) ", //in any case, must not be at an unprocessable notification stage 
                                    //" AND (attribute_not_exists(replacedBy) OR attribute_type(replacedBy, :cond_attType_replacedBy)) ", //the signature was not revoked
                "ExpressionAttributeValues": {
                    ":cond_sts": sts,
                    ":cond_stsUpdatedAt1": now - (sinceWhenSeconds * 1000),
                    ":cond_stsUpdatedAt2": now - (waitingSeconds * 1000),
                    ":cond_requesterCallbackSts1": "EMPTY_REQUESTER_CALLBACK",
                    ":cond_requesterCallbackSts2": "CALLBACK_URL_OWNERSHIP_ERROR",
                    ":cond_requesterCallbackSts3": "SIGNED_DOCUMENT_UNCOMPRESSION_ERROR",
                    ":cond_requesterCallbackSts4": "INVALID_REQUESTER_CALLBACK",
                    ":cond_requesterCallbackSts5": "EMPTY_SIGNED_CONTENT",
                    ":cond_requesterCallbackSts6": "NOTIFIED"
                    //":cond_attType_replacedBy": "NULL"
                }         
            };

            if (["SIGNED", "READY_OR_ERRORED_SIGNATURE_QUEUE_FAILED"].indexOf(sts) !== -1) {
                dbParams.FilterExpression = dbParams.FilterExpression +
                                            " AND requesterCallbackSts IN (:cond_requesterCallbackSts6, :cond_requesterCallbackSts7) AND requesterCallbackStsUpdatedAt < :cond_requesterCallbackStsUpdatedAt ";
                dbParams.ExpressionAttributeValues = {
                    ...(dbParams.ExpressionAttributeValues),
                    ":cond_requesterCallbackSts6": "AWAITING_SIGNATURE",
                    ":cond_requesterCallbackSts7": "NOTIFICATION_ERROR",
                    ":cond_requesterCallbackStsUpdatedAt": now - (waitingSeconds * 1000)
                }
            }      
            
            if (sinceWhenSeconds !== null) {
                dbParams.FilterExpression += " AND createdAt >= :createdAt ";
                dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
            }
            
            if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
                dbParams["ProjectionExpression"] = attributesToProject.join(",")
            }

            let promisifyQuery = () => {
                return new Promise(async (resolve, reject) => {
                    try {
                        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams, pageSizePerStatus);
                        return resolve(result);
                    } catch (e) {
                        return reject(e);
                    }
                });
            };
            promisesQueryIndexPerSts.push({"sts": sts, "index": dbParams.IndexName, "promise": promisifyQuery()});
        });

        let results = [];
        let errors = [];

        await Promise.all(promisesQueryIndexPerSts.map((pendingPromise) => {
            return pendingPromise.promise.then((res) => {
            //console.info(`queryFinishedOrErroredNotNotifiedYet: query over index ${pendingPromise.index} with sts = ${pendingPromise.sts} successfully completed.`);
            results = results.concat(res || []);
            })
            .catch((e) => {
                console.warn(`queryFinishedOrErroredNotNotifiedYet: an error has occurred while querying index ${pendingPromise.index} with sts = ${pendingPromise.sts}.`, e);
                errors.push(e);
            });
        })).catch((e) => {
            throw errorHandlerHelper.error(500, "QueryFinishedOrErroredNotNotifiedTransactionsError", "An unexpected error has ocurred while querying finished signature transactions, but with requester notification not performed yet.", e);
        });

        if (errors.length > 0) {
            throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table for fetching records with finished signature transactions, but with requester notification not performed yet.", (errors.length === 1) ? errors[0] : errors);
        }

        return sortResults(results, "stsUpdatedAt", 1).slice(0, pageSize);
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode || 500, "QueryFinishedOrErroredNotNotifiedYetError", "Unexpected exception while performing query for retrieving records with finished signature transactions, but with requester notification not performed yet.", e);
    }
};

//do not use this never more
module.exports.scanFinishedOrErroredNotNotifiedYet = async (waitingSeconds, sinceWhenSeconds, pageSize, attributesToProject) => {
    let now = Date.now();
    let waitingMilisseconds = now - ((waitingSeconds || 30) * 1000); 
    
    let dbParams = {
        "FilterExpression": "(" +
                                ` (sts = :cond_sts1 AND requesterCallbackSts IN (:cond_requesterCallbackSts1, :cond_requesterCallbackSts2) AND requesterCallbackStsUpdatedAt < :cond_requesterCallbackStsUpdatedAt ${(sinceWhenSeconds !== null) ? `AND createdAt >= :createdAt` : ``}) ` + //signed, but not notified yet
                                ` OR (sts IN (:cond_sts2, :cond_sts3, :cond_sts4, :cond_sts5, :cond_sts6, :cond_sts7, :cond_sts8, :cond_sts9, :cond_sts10, :cond_sts11, :cond_sts12, :cond_sts13, :cond_sts14, :cond_sts15) AND stsUpdatedAt < :cond_stsUpdatedAt ${(sinceWhenSeconds !== null) ? `AND createdAt >= :createdAt` : ``}) ` +  //unprocessable signature states (impossible to proceed further signature processing at all)
                            ")" + 
                            " AND (requesterCallbackSts <> :cond_requesterCallbackSts3 AND requesterCallbackSts <> :cond_requesterCallbackSts4 AND requesterCallbackSts <> :cond_requesterCallbackSts5 AND requesterCallbackSts <> :cond_requesterCallbackSts6 AND requesterCallbackSts <> :cond_requesterCallbackSts7) ", //in any case, must not be at an unprocessable notification stage 
        "ExpressionAttributeValues": {
            ":cond_sts1": "SIGNED",
            ":cond_requesterCallbackSts1": "AWAITING_SIGNATURE",
            ":cond_requesterCallbackSts2": "NOTIFICATION_ERROR",
            ":cond_requesterCallbackStsUpdatedAt": waitingMilisseconds,
            ":cond_sts2": "MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR",
            ":cond_sts3": "PRECONDITION_ERROR", //kept for legacy reasons. This status has been replaced by MISSING_SERVICE_NOTIFICATION_CALLBACK_ERROR
            ":cond_sts4": "UNSIGNED_DOCUMENT_UNCOMPRESSION_ERROR",
            ":cond_sts5": "PROVIDER_SIGNATURE_ID_INCONSISTENCY",
            ":cond_sts6": "INDETERMINISTIC_RECORD_ERROR",
            ":cond_sts7": "INVALID_PROVIDER",
            ":cond_sts8": "REPROCESSING_NOT_STARTED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            ":cond_sts9": "INVALID_PROVIDER_SIGNATURE_ID",
            ":cond_sts10": "REPROCESSING_UNFINISHED_SIGNATURE_TRANSACTION_EXECUTION_ERROR",
            ":cond_sts11": "CHECK_SIGNATURE_REQUEST_ERROR",
            ":cond_sts12": "SIGNATURE_ERROR",
            ":cond_sts13": "UNKNOWN_SIGNATURE_STATUS",
            ":cond_sts14": "READY_SIGNATURE_FILE_URL_ERROR",
            ":cond_sts15": "REPROCESSING_NOT_NOTIFIED_FINISHED_OR_ERRORED_TRANSACTION_EXECUTION_ERROR",
            ":cond_stsUpdatedAt": waitingMilisseconds,
            ":cond_requesterCallbackSts3": "EMPTY_REQUESTER_CALLBACK",
            ":cond_requesterCallbackSts4": "CALLBACK_URL_OWNERSHIP_ERROR",
            ":cond_requesterCallbackSts5": "SIGNED_DOCUMENT_UNCOMPRESSION_ERROR",
            ":cond_requesterCallbackSts6": "INVALID_REQUESTER_CALLBACK",
            ":cond_requesterCallbackSts7": "EMPTY_SIGNED_CONTENT"
        }
    };

    if (sinceWhenSeconds !== null) {
        dbParams.ExpressionAttributeValues[":createdAt"] = now - (sinceWhenSeconds * 1000);
    }

    if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
        dbParams["ProjectionExpression"] = attributesToProject.join(",")
    }

    try {
        let result = await dynamoDBHelper.scan(process.env.RSRC_SIGNATURES_TABLE, dbParams, (pageSize || 100));
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to scan signature table for fetching records with finished signature transactions, but with requester notification not performed yet.", e);
    }
};

module.exports.queryNotProcessed = async (sinceWhenSeconds, pageSize, attributesToProject) => {
    try {
        let now = Date.now();

        let promisesQueryIndexPerSts = [];

        const notNotifiedCallbackStates = [
            "AWAITING_SIGNATURE",
            "NOTIFICATION_ERROR",
            "EMPTY_REQUESTER_CALLBACK",
            "INVALID_REQUESTER_CALLBACK",
            "EMPTY_SIGNED_CONTENT",
            "CALLBACK_URL_OWNERSHIP_ERROR",
            "SIGNED_DOCUMENT_UNCOMPRESSION_ERROR"
        ];

        let pageSizePerStatus = Math.ceil(((pageSize || 100) / notNotifiedCallbackStates.length) * (notNotifiedCallbackStates.length / 2)); //multiplied by a factor (number of states divided by 2) to rise chances of fetching the more records it can at each status
        sinceWhenSeconds = sinceWhenSeconds || (60 * 60);

        notNotifiedCallbackStates.forEach((callbackSts) => {
            let dbParams = {
                "IndexName": "requesterCallbackStsUpdatedAtIndex",
                "KeyConditionExpression": "requesterCallbackSts = :cond_requesterCallbackSts " +
                                            " AND stsUpdatedAt BETWEEN :cond_stsUpdatedAt1 AND :cond_stsUpdatedAt2", //elapsed time
                "FilterExpression": "sts <> :cond_sts ",
                "ExpressionAttributeValues": {
                    ":cond_sts": "SIGNED",
                    ":cond_requesterCallbackSts": callbackSts,
                    ":cond_stsUpdatedAt1": now - (24 * 60 * 60 * 1000), //24 hours
                    ":cond_stsUpdatedAt2": now - (sinceWhenSeconds * 1000)
                }
            };

            if (attributesToProject && Array.isArray(attributesToProject) && attributesToProject.length > 0) {
                dbParams["ProjectionExpression"] = attributesToProject.join(",")
            }

            let promisifyQuery = () => {
                return new Promise(async (resolve, reject) => {
                    try {
                        let result = await dynamoDBHelper.query(process.env.RSRC_SIGNATURES_TABLE, dbParams, pageSizePerStatus);
                        return resolve(result);
                    } catch (e) {
                        return reject(e);
                    }
                });
            };
            promisesQueryIndexPerSts.push({"requesterCallbackSts": callbackSts, "index": dbParams.IndexName, "promise": promisifyQuery()});
        });

        let results = [];
        let errors = [];

        await Promise.all(promisesQueryIndexPerSts.map((pendingPromise) => {
            return pendingPromise.promise.then((res) => {
            //console.info(`queryNotStartedYet: query over index ${pendingPromise.index} with sts = ${pendingPromise.sts} successfully completed.`);
            results = results.concat(res || []);
            })
            .catch((e) => {
                console.warn(`queryNotProcessed: an error has occurred while querying index ${pendingPromise.index} with requesterCallbackSts = ${pendingPromise.requesterCallbackSts}.`, e);
                errors.push(e);
            });
        })).catch((e) => {
            throw errorHandlerHelper.error(500, "QueryNotProcessedSignatureTransactionsError", "An unexpected error has ocurred while querying not processed signature transactions.", e);
        });

        if (errors.length > 0) {
            throw errorHandlerHelper.error(500, "DatabaseError", "Failed to query signature table for fetching records with not processed signature transactions.", (errors.length === 1) ? errors[0] : errors);
        }

        return sortResults(results, "createdAt", 1).slice(0, pageSize);
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode || 500, "QueryNotProcessedError", "Unexpected exception while performing query for retrieving not processed signature transactions.", e);
    }
};

module.exports.incrementCheckCounter = async (tableKey, checkRequestId, initialValue) => {
    try {
        if (!tableKey || !tableKey.requestId) {
            throw errorHandlerHelper.error(400, "MissingParameterError", "Missing tableKey parameter.");
        }

        if (!checkRequestId) {
            throw errorHandlerHelper.error(400, "MissingParameterError", "Missing checkRequestId parameter.");
        }

        let dbParams = {
            "Key": {
                "requestId": tableKey.requestId,
                "signerIdentity": tableKey.signerIdentity
            },
            "UpdateExpression": `SET checkCounter = ${(initialValue === false) ? "checkCounter + :new_checkCounterIncrement" : ":new_checkCounterIncrement"}, lastCheckAt = :new_lastCheckAt, lastCheckRequestId = :new_lastCheckRequestId`,
            "ExpressionAttributeValues": {
                ":new_checkCounterIncrement": 1,
                ":new_lastCheckAt": Date.now(),
                ":new_lastCheckRequestId": checkRequestId
            },
            "ReturnValues": "NONE"
        };

        await dynamoDBHelper.update(process.env.RSRC_SIGNATURES_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to increment signature check counter.", e);
    }
};

module.exports.incrementAdminOnErrorNotificationCounter = async (tableKey, initialValue) => {
    try { 
        if (!tableKey || !tableKey.requestId) {
            throw errorHandlerHelper.error(400, "MissingParameterError", "Missing tableKey parameter.");
        }

        let dbParams = {
            "Key": {
                "requestId": tableKey.requestId,
                "signerIdentity": tableKey.signerIdentity
            },
            "UpdateExpression": `SET adminOnErrorNotificationCount = ${(initialValue === false) ? "adminOnErrorNotificationCount + :new_adminOnErrorNotificationCount" : ":new_adminOnErrorNotificationCount"}, adminOnErrorLasNotifiedAt = :new_adminOnErrorLasNotifiedAt`,
            "ExpressionAttributeValues": {
                ":new_adminOnErrorNotificationCount": 1,
                ":new_adminOnErrorLasNotifiedAt": Date.now()
            },
            "ReturnValues": "NONE"
        };

        await dynamoDBHelper.update(process.env.RSRC_SIGNATURES_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to increment admin error notification counter.", e);
    }
};

const sortResults = (array, sortKey, order = 1) => {
    const asc = (sortKey) => {
        return (a, b) => {
            if (!a[sortKey]) {
                return 0;
            }

            if(a[sortKey] < b[sortKey]) { 
                return -1; 
            }

            if(a[sortKey] > b[sortKey]) { 
                return 1; 
            }

            return 0;
        }
    };

    const desc = (sortKey) => {
        return (a, b) => {
            if (!a[sortKey]) {
                return 0;
            }

            if(a[sortKey] > b[sortKey]) { 
                return -1; 
            }

            if(a[sortKey] < b[sortKey]) { 
                return 1; 
            }
            
            return 0;
        }
    };
    
    if (order >= 0) {
        return array.sort(asc(sortKey));
    } else {
       return array.sort(desc(sortKey));
    }
};

const shuffleOverfetchedResults = (array, limitSize) => {
    if (array.length <= limitSize) {
        return array;
    }

    let currentIndex = array.length, 
        temporaryValue, 
        randomIndex;
  
    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
  
      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }

    return array;
};
