"use strict";

const dynamoDBHelper = require("../../helpers/dynamoDB");
const errorHandlerHelper = require("../../helpers/errorHandler");
const generalTableUtilities = require("./generalUtilities");


module.exports.put = async (tableKey, data, requestContextIdentity) => {
    let dbParams = {
        "Item": {
            "requestId": tableKey.requestId,
            "signatureRequestId": tableKey.signatureRequestId || null,
            "signatureShortId": tableKey.signatureShortId || null,
            "checkParameter": data.checkParameter,
            "checkResult": data.checkResult,
            ...(await generalTableUtilities.formatRequestIdentityMetadata(requestContextIdentity))
        },
        "ConditionExpression": "attribute_not_exists(requestId)"
    };

    if (dbParams.Item.checkResult) {
        if (typeof dbParams.Item.checkResult.rawContent === "string") {
            dbParams.Item.checkResult.rawContent = dbParams.Item.checkResult.rawContent.substring(0, 50) + "...[TRUNCATED]";
        }

        if (dbParams.Item.checkResult.sourceDocumentFiles && Array.isArray(dbParams.Item.checkResult.sourceDocumentFiles.files)) {
            for (let i = 0, totI = dbParams.Item.checkResult.sourceDocumentFiles.files.length; i < totI; i++) {
                if (typeof dbParams.Item.checkResult.sourceDocumentFiles.files[i].fileContent === "string") {
                    dbParams.Item.checkResult.sourceDocumentFiles.files[i].fileContent = dbParams.Item.checkResult.sourceDocumentFiles.files[i].fileContent.substring(0, 50) + "...[TRUNCATED]";
                }
            }
        }
    }
  
    try {
        await dynamoDBHelper.put(process.env.RSRC_SIGNATURES_CHECK_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to persist data into signatures check table.", e);
    }
};