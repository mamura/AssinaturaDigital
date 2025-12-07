"use strict";

const errorHandlerHelper = require("./errorHandler");
const jsonSchemaHelper = require("./jsonSchema");
const uuidRegex = new RegExp(/^[0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12}$/i);

module.exports.validateRequestId = (requestId) => {
    if (!requestId) {
        throw errorHandlerHelper.error(500, "MissingRequestId", "Missing Request ID. Unable to proceed.");
    }

    if (!requestId.match(uuidRegex)) {
        throw errorHandlerHelper.error(500, "InvalidRequestId", "Request ID is not a valid UUID. Unable to proceed.");
    }
}

module.exports.validateLambdaParameters = (lambdaEvent, lambdaContext) => {
    // console.log("Lambda Event:", lambdaEvent);
    // console.log("Lambda Context:", lambdaContext);

    if (!lambdaEvent || !(typeof lambdaEvent === "object") || !(lambdaEvent.constructor === Object)) {
        throw errorHandlerHelper.error(500, "InvalidLambdaEventParameter", `Event parameter passed to requested Lambda function is invalid. Unable to proceed.`);
    }

    if (!lambdaContext || !(typeof lambdaContext === "object") || !(lambdaContext.constructor === Object)) {
        throw errorHandlerHelper.error(500, "InvalidLambdaContextParameter", `Context parameter passed to Lambda function is invalid. Unable to proceed.`);
    }
};

module.exports.parseSqsBody = async (lambdaEvent, bodySchema, batchSize) => {
    if (!lambdaEvent) {
        throw errorHandlerHelper.error(500, "MissingParameterError", "Lambda event object has not informed to parse asynchornous event body.");
    }

    let requestBody = lambdaEvent.Records;

    if (!requestBody) {
        throw errorHandlerHelper.error(500, "MissingParameterError", "SQS body has not been found in Lambda event object.");
    }

    if (!Array.isArray(requestBody)) {
        throw errorHandlerHelper.error(500, "InvalidSQSBody", "Body in Lambda event object is not a valid SQS body.");
    }

    batchSize = (typeof batchSize === "number") ? batchSize : 1;

    if (requestBody.length > batchSize) {
        throw errorHandlerHelper.error(500, "BatchSizeExceeded", `The length of SQS body (${requestBody.length}) exceeded the allowed batch size (${batchSize}).`);
    }

    requestBody = requestBody.map((body) => {
        let transpiledBody = {
            "messageId": body.messageId,
            "receiptHandle": body.receiptHandle,
            "messagePayload": body.body || null 
        };

        Object.keys(body.messageAttributes).forEach((key) => {
            let value = null;
            switch (body.messageAttributes[key].dataType) {
                case "String":
                    value = body.messageAttributes[key].stringValue;
                    break;
                case "Number":
                    value = body.messageAttributes[key].value || body.messageAttributes[key].stringValue;
                    if (!(value === null || value === undefined)) {
                        value = Number(value);
                    }
                    break;
            }
            transpiledBody[key] = value;
        });

        return transpiledBody;

    });

    let parsedBody = await module.exports.parseBody(requestBody, bodySchema);

    return parsedBody;
};

module.exports.parseBody = async (requestBody, bodySchema) => {
    let parsedBody = null;

    try {
        if (typeof requestBody === "string") {
            parsedBody = JSON.parse(requestBody);
        } else {
            parsedBody = requestBody;
        }
    } catch (e) {
        throw errorHandlerHelper.error(400, "InvalidBody", "Invalid request body. Unable to proceed.", e);
    }
    
    if (bodySchema) {
        try {
            await jsonSchemaHelper.validate(parsedBody, bodySchema);
        } catch (e) {
            throw errorHandlerHelper.error(400, "RequestBodyValidationError", "Request body is invalid.", e);
        }
    }

    return parsedBody;
};

module.exports.parsePathParams = async (pathParams, pathParamsSchema) => {
    let parsedPathParams = null;

    try {
        if (typeof pathParams === "string") {
            parsedPathParams = JSON.parse(pathParams);
        } else {
            parsedPathParams = pathParams;
        }
    } catch (e) {
        throw errorHandlerHelper.error(400, "InvalidPathParams", "Invalid path parameters. Unable to proceed.", e);
    }
    
    if (pathParamsSchema) {
        try {
            await jsonSchemaHelper.validate(parsedPathParams, pathParamsSchema);
        } catch (e) {
            throw errorHandlerHelper.error(400, "PathParamsValidationError", "Path parameters content is invalid.", e);
        }
    }

    return parsedPathParams;
};

module.exports.parseQueryStringParams = async (queryStringParams, queryStringParamsSchema) => {
    let parsedQueryStringParams = null;

    try {
        if (typeof queryStringParams === "string") {
            parsedQueryStringParams = JSON.parse(queryStringParams);
        } else {
            parsedQueryStringParams = queryStringParams;
        }
    } catch (e) {
        throw errorHandlerHelper.error(400, "InvalidQueryStringParams", "Invalid query string parameters. Unable to proceed.", e);
    }
    
    if (queryStringParamsSchema) {
        try {
            await jsonSchemaHelper.validate(parsedQueryStringParams, queryStringParamsSchema);
        } catch (e) {
            throw errorHandlerHelper.error(400, "QueryStringParamsValidationError", "Query string parameters are invalid.", e);
        }
    }

    return parsedQueryStringParams;
};