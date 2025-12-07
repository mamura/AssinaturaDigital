"use strict";

const dynamoDBHelper = require("../../helpers/dynamoDB");
const errorHandlerHelper = require("../../helpers/errorHandler");
const generalTableUtilities = require("./generalUtilities");

module.exports.put = async (tableKey, data, requestContextIdentity) => {
    let dbParams = {
        "Item": {
            "requestId": tableKey.requestId,
            "signerIdentity": tableKey.signerIdentity,
            "provider": data.provider,
            "sts": data.sts,
            "stsUpdatedAt": (data.sts) ? Date.now() : null,
            "jti": data.jti || null,
            "expiresInSeconds": data.expiresInSeconds || null,
            "signerCertificates": data.signerCertificates || null,
            "stampExpiration": data.stampExpiration || null,
            "cached": null,
            "environment": data.environment || null,
            "err": null,
            "useCache": data.useCache || false,
            ...(await generalTableUtilities.formatRequestIdentityMetadata(requestContextIdentity))
        },
        "ConditionExpression": "attribute_not_exists(requestId)"
    };
  
    try {
        await dynamoDBHelper.put(process.env.RSRC_SIGNERS_AUTHORIZATION_TABLE, dbParams);
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to persist data into signers authorization table.", e);
    }
};

module.exports.update = async (tableKey, data, conditions, options) => {
    options = options || {};

    let dbParams = {
        "Key": {
          "requestId": tableKey.requestId,
          "signerIdentity": tableKey.signerIdentity
        },
        "UpdateExpression": "SET ",
        "ExpressionAttributeValues": {},
        "ReturnValues": options.returnValues || "NONE"
    };

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

    const updatableFields = [
        "sts",
        "jti",
        "signerCertificates",
        "stampExpiration",
        "expiresInSeconds",
        "cached",
        "err",
        "environment"
    ];

    for (let key in data) {
        if (data.hasOwnProperty(key)) {
            if (updatableFields.indexOf(key) === -1) {
                throw errorHandlerHelper.error(500, "DatabaseValidationError", `Field ${key} is not in the updatable field list for table ${process.env.RSRC_SIGNERS_AUTHORIZATION_TABLE}.`);
            }

            dbParams.UpdateExpression += ` ${key} = :new_${key},`;
            dbParams.ExpressionAttributeValues[`:new_${key}`] = data[key];

            if (key === "sts") {
                dbParams.UpdateExpression += ` ${key}UpdatedAt = :new_${key}UpdatedAt,`;
                dbParams.ExpressionAttributeValues[`:new_${key}UpdatedAt`] = Date.now();
            }
        }
    }

    try {
        let result = await dynamoDBHelper.update(process.env.RSRC_SIGNERS_AUTHORIZATION_TABLE, dbParams);
        return result;
    } catch (e) {
        throw errorHandlerHelper.error(500, "DatabaseError", "Failed to update signers authorization data in signers authorization table.", e);
    }
};
