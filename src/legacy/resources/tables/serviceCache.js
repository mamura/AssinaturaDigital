"use strict";

const dynamoDBHelper = require("../../helpers/dynamoDB");
const errorHandlerHelper = require("../../helpers/errorHandler");

module.exports.get = async(entryKey) => {
    if (!process.env.RSRC_SERVICE_CACHE_TABLE) {
        throw errorHandlerHelper.error(500, "UnknownResource", "There is no cache table assigned to this service!");
    }

    let dbParams = {
        "Key": {
          "entryKey": entryKey
        },
        "ProjectionExpression": "entryKey, entryValue, createdAt, updatedAt"
    };

    try {
        let result = await dynamoDBHelper.get(process.env.RSRC_SERVICE_CACHE_TABLE, dbParams);

        /*if (!result || result.entryValue === undefined || result.entryValue === null) { //null or undefined
            throw errorHandlerHelper.error(404, "ServiceCacheItemNotFound", `No item found in service cache table for entry key ${entryKey}.`);
        }*/
        
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(e.statusCode || 500, "ServiceCacheRetrievalError", "Failed to retrieve item from service cache table.", e);
    }
};

module.exports.put = async (entryKey, entryValue) => {
    if (!process.env.RSRC_SERVICE_CACHE_TABLE) {
        throw errorHandlerHelper.error(500, "UnknownResource", "There is no cache table assigned to this service!");
    }

    let dbParams = {
        "Item": {
            "entryKey": entryKey,
            "entryValue": entryValue
        },
        "ConditionExpression": "attribute_not_exists(entryKey)"
    };
  
    try {
        await dynamoDBHelper.put(process.env.RSRC_SERVICE_CACHE_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to persist data into service cache table.", e);
    }
};

module.exports.update = async (entryKey, entryValue) => {
    if (!process.env.RSRC_SERVICE_CACHE_TABLE) {
        throw errorHandlerHelper.error(500, "UnknownResource", "There is no cache table assigned to this service!");
    }

    let dbParams = {
        "Key": {
          "entryKey": entryKey,
        },
        "UpdateExpression": "SET entryValue = :new_entryValue",
        "ExpressionAttributeValues": {
          ":new_entryValue": entryValue
        },
        "ReturnValues": "NONE"
    };

    try {
        await dynamoDBHelper.update(process.env.RSRC_SERVICE_CACHE_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to update entry data in service cache table.", e);
    }
};