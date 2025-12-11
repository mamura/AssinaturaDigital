"use strict";

const errorHandlerHelper = require("./errorHandler");
const jsonSchemaHelper = require("./jsonSchema");
const asyncRetry = require("async/retry");

const AWS = require("aws-sdk");
AWS.config.update({region: process.env.CLOUD_REGION});
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const DYNAMO_DEFAULT_SCAN_PAGE_SIZE = 25;
const DYNAMO_DEFAULT_QUERY_PAGE_SIZE = 25;
const DYNAMO_DEFAULT_SCAN_LIMIT = 50;
const DYNAMO_DEFAULT_SCAN_TOTAL_PARALLEL_SEGMENTS = 4;
const DYNAMO_DEFAULT_RETRIES_ON_CAPACITY_EXCEEDED = 3;

const actionDynamoDBSchemas = {
    "get": {
        "$id": "dynamoDb-Get-Schema",
        "$async": true,
        "type": "object",
        "properties": {
          "TableName": {
            "type": "string",
            "minLength": 1
          },
          "Key": { 
            "type": "object",
            "propertyNames": {
                "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
            },
            "minProperties": 1
          },
          "ProjectionExpression": {
            "type": "string"
          },
          "ReturnConsumedCapacity": {
            "type": "string",
            "enum": [
                "INDEXES",
                "TOTAL",
                "NONE"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "TableName",
          "Key"
        ]
    },
    "put": {
        "$id": "dynamoDb-Put-Schema",
        "$async": true,
        "type": "object",
        "properties": {
          "TableName": {
            "type": "string",
            "minLength": 1
          },
          "Item": { 
            "type": "object",
            "propertyNames": {
                "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
            },
            "minProperties": 1
          },
          "ConditionExpression": {
            "type": "string",
            "minLength": 1
          },
          "ReturnConsumedCapacity": {
            "type": "string",
            "enum": [
                "INDEXES",
                "TOTAL",
                "NONE"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "TableName",
          "Item"
        ]
    },
    "update": {
        "$id": "dynamoDb-Update-Schema",
        "$async": true,
        "type": "object",
        "properties": {
          "TableName": {
            "type": "string",
            "minLength": 1
          },
          "Key": { 
            "type": "object",
            "propertyNames": {
                "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
            },
            "minProperties": 1
          },
          "UpdateExpression": {
            "type": "string",
            "minLength": 1,
            "pattern": "^SET.*"
          },
          "ConditionExpression": {
            "type": "string",
            "minLength": 1
          },
          "ExpressionAttributeValues": { 
            "type": "object",
            "propertyNames": {
                "pattern": "^:[A-Za-z_][A-Za-z0-9_]*$"
            },
            "minProperties": 1
          },
          "ReturnValues": {
            "type": "string",
            "enum": [
                "NONE",
                "ALL_OLD",
                "UPDATED_OLD",
                "ALL_NEW",
                "UPDATED_NEW"
            ]
          },
          "ReturnConsumedCapacity": {
            "type": "string",
            "enum": [
                "INDEXES",
                "TOTAL",
                "NONE"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "TableName",
          "Key",
          "UpdateExpression",
          "ReturnValues"
        ]
    },
    "query": {
        "$id": "dynamoDb-Query-Schema",
        "$async": true,
        "type": "object",
        "properties": {
          "TableName": {
            "type": "string",
            "minLength": 1
          },
          "IndexName": {
            "type": "string",
            "minLength": 1
          },
          "Limit": {
            "type": "integer",
            "minimum": 0,
          },
          "KeyConditionExpression": { 
            "type": "string",
            "minLength": 1
          },
          "ExpressionAttributeNames": {
            "type": "object",
            "minProperties": 1
          },
          "ExpressionAttributeValues": {
            "type": "object",
            "minProperties": 1
          },
          "ProjectionExpression": {
            "type": "string"
          },
          "ExclusiveStartKey": {
            "type": "object",
            "minProperties": 1
          },
          "FilterExpression": {
            "type": "string"
          },
          "ExclusiveStartKey": {
            "type": "object",
            "minProperties": 1
          },
          "ReturnConsumedCapacity": {
            "type": "string",
            "enum": [
                "INDEXES",
                "TOTAL",
                "NONE"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "TableName",
          "KeyConditionExpression"
        ]
    },
    "scan": {
        "$id": "dynamoDb-Scan-Schema",
        "$async": true,
        "type": "object",
        "properties": {
          "TableName": {
            "type": "string",
            "minLength": 1
          },
          "Limit": {
            "type": "integer",
            "minimum": 0,
          },
          "Segment": {
            "type": "integer",
            "minimum": 0,
          },
          "TotalSegments": {
            "type": "integer",
            "minimum": 1,
          },
          "ExpressionAttributeNames": {
            "type": "object",
            "minProperties": 1
          },
          "ExpressionAttributeValues": {
            "type": "object",
            "minProperties": 1
          },
          "FilterExpression": {
            "type": "string"
          },
          "ProjectionExpression": {
            "type": "string"
          },
          "ExclusiveStartKey": {
            "type": "object",
            "minProperties": 1
          },
          "ReturnConsumedCapacity": {
            "type": "string",
            "enum": [
                "INDEXES",
                "TOTAL",
                "NONE"
            ]
          }
      },
      "additionalProperties": false,
      "required": [
        "TableName"
      ]
    }
};

module.exports.get = async (tableName, dbParams) => {
    dbParams = {
        "TableName": tableName,
        "ReturnConsumedCapacity": "NONE",
        ...dbParams
    };

    try {
      const result = await call("get", dbParams);
      return result.Item || null;
    } catch (e) {
      if (e.errorType === "DatabaseError") {
        if (e.causedBy && e.causedBy.errorType === "ResourceNotFoundException") { //no item has been found. That's ok for our purposes.
          return null;
        }
      }
      throw e; //otherwise, throw the error
    }
};

module.exports.put = async (tableName, dbParams) => {
    dbParams.Item.createdAt = Date.now();
    dbParams.Item.updatedAt = null;

    dbParams = {
        "TableName": tableName,
        "ReturnConsumedCapacity": "NONE",
        ...dbParams
    };

    await call("put", dbParams);

    return dbParams.Item;
};

module.exports.update = async (tableName, dbParams) => {
    let updateExpression = dbParams.UpdateExpression.trim();

    updateExpression += ((updateExpression[updateExpression.length - 1] === ",") ? "" : ", ") + "updatedAt = :updatedAt";
    dbParams.UpdateExpression = updateExpression;
    dbParams.ExpressionAttributeValues[":updatedAt"] = Date.now();
    
    dbParams = {
        "TableName": tableName,
        "ReturnConsumedCapacity": "NONE",
        ...dbParams
    };

    try {
      let result = await call("update", dbParams);
      return (result && result.Attributes) ? result.Attributes : null;
    } catch (e) {
      if (e.errorType === "DatabaseError") {
        if (e.causedBy && e.causedBy.errorType === "ConditionalCheckFailedException") { //no item affected by udate. That's ok for our purposes.
          return null;
        }
      }
      throw e; //otherwise, throw the error
    }  
};

module.exports.query = async (tableName, dbParams, pageSize) => {
  pageSize = pageSize || DYNAMO_DEFAULT_QUERY_PAGE_SIZE;
  dbParams = {
      "TableName": tableName,
      "ReturnConsumedCapacity": "NONE",
      ...dbParams
  };

  let result = await call("query", dbParams);
  let resultsToReturn = (result && result.Items) ? result.Items : [];

  while (resultsToReturn.length < pageSize && result.LastEvaluatedKey) {
    dbParams["ExclusiveStartKey"] = result.LastEvaluatedKey;
    result = await call("query", dbParams);
    resultsToReturn = resultsToReturn.concat((result && result.Items) ? result.Items : []);
  }

  return resultsToReturn.slice(0, pageSize);
};

module.exports.scan = async (tableName, dbParams, pageSize, totalParallelSegments) => {
  pageSize = pageSize || DYNAMO_DEFAULT_SCAN_PAGE_SIZE;
  totalParallelSegments = totalParallelSegments || DYNAMO_DEFAULT_SCAN_TOTAL_PARALLEL_SEGMENTS;

  dbParams = {
      "TableName": tableName,
      "ReturnConsumedCapacity": "NONE",
      "Limit": DYNAMO_DEFAULT_SCAN_LIMIT,
      ...dbParams
  };

  let scanWorkers = [];

  // Make scan operation parallel to avoid performance issues
  // Please, refer to https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html#Scan.ParallelScan for further information
  for (let seg = 0; seg < totalParallelSegments; seg++) {
    scanWorkers.push({"segment": seg, "promise": scanWorker(Math.ceil(pageSize / totalParallelSegments), dbParams, seg, totalParallelSegments)});
  }

  let scanWorkersResults = await Promise.all(scanWorkers.map((scanWorker) => {
    return scanWorker.promise.then((res) => {
      //console.info(`Scan worker for segment ${scanWorker.segment} successfully completed!`);
      return res;
    })
    .catch((e) => {
      console.error(`An error has occurred while executing scan worker for segment ${scanWorker.segment}. Error details: `, e);
      return e; 
    });
  })).then((results) => {
    return results;
  }).catch((e) => {
    throw errorHandlerHelper.error(500, "DynamoDBScanFail", `An unexpected error has ocurred while executing segmented scan operation over table ${tableName}.`, e);
  });

  let allScanWorkersReturnedWithError = true;
  let allScanErrors = [];

  let resultsToReturn = scanWorkersResults.reduce((accumulated, scanWorkerResult) => {
    if (!(scanWorkerResult instanceof Error)) {
      allScanWorkersReturnedWithError = false;
      accumulated = accumulated.concat(scanWorkerResult);
    } else {
      allScanErrors.push(scanWorkerResult);
    }
    return accumulated;
  }, []);

  if (allScanWorkersReturnedWithError === true) {
    throw errorHandlerHelper.error(500, "DynamoDBScanFail", `Scan operation could not be performed for all scan workers.`, allScanErrors);
  }

  return resultsToReturn.slice(0, pageSize);
};

const scanWorker = (pageSize, dbParams, segment, totalParallelSegments) => {
  return new Promise(async (resolve, reject) => {
    try {
      dbParams = {
        "Segment": segment,
        "TotalSegments": totalParallelSegments,
        ...dbParams
      };

      let result = await call("scan", dbParams);
      let resultsToReturn = (result && result.Items) ? result.Items : [];

      while (resultsToReturn.length < pageSize && result.LastEvaluatedKey) {
        dbParams["ExclusiveStartKey"] = result.LastEvaluatedKey;
        result = await call("scan", dbParams);
        resultsToReturn = resultsToReturn.concat((result && result.Items) ? result.Items : []);
      }

      return resolve(resultsToReturn);

    } catch (e) {
      return reject(e);
    }
  });
};

const call = (action, dbParams) => {
  return new Promise(async (resolve, reject) => {
    try {
      await jsonSchemaHelper.validate(dbParams, actionDynamoDBSchemas[action]);
    } catch (e) {
      throw errorHandlerHelper.error(500, "DatabaseActionValidationError", `Failed to valiate database params for ${action} action.`, e);
    }

    asyncRetry({
      "times": DYNAMO_DEFAULT_RETRIES_ON_CAPACITY_EXCEEDED,
      "interval": (retryCount) => {
        return 50 * Math.pow(2, retryCount);
      },
      "errorFilter": (err) => {
        return ((err.statusCode && err.statusCode >= 500) ||
                (err.status && err.status >= 500) ||
                ["ProvisionedThroughputExceededException", "RequestLimitExceeded", "LimitExceededException", "ThrottlingException"].indexOf(err.errorType) !== -1);
      }
    }, 
    (callbackOfAsyncRetry) => {
      dynamoDb[action](dbParams, (err, result) => {
        if (err) {
          return callbackOfAsyncRetry(err);
        }
        return callbackOfAsyncRetry(null, result);
      });
    },
    (err, result) => {
      if (err) {
        return reject(errorHandlerHelper.error(500, "DatabaseError", `Failed to execute action ${action} on database.`, err));
      }
      return resolve(result);
    });
  });
};
