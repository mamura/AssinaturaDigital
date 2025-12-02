"use strict";

const errorHandlerHelper = require("./errorHandler");

const httpStatus = {
  "100": "Continue",
  "101": "Switching Protocols",
  "102": "Processing",
  "200": "OK",
  "201": "Created",
  "202": "Accepted",
  "203": "Non-authoritative Information",
  "204": "No Content",
  "205": "Reset Content",
  "206": "Partial Content",
  "207": "Multi-Status",
  "208": "Already Reported",
  "226": "IM Used",
  "300": "Multiple Choices",
  "301": "Moved Permanently",
  "302": "Found",
  "303": "See Other",
  "304": "Not Modified",
  "305": "Use Proxy",
  "307": "Temporary Redirect",
  "308": "Permanent Redirect",
  "400": "Bad Request",
  "401": "Unauthorized",
  "402": "Payment Required",
  "403": "Forbidden",
  "404": "Not Found",
  "405": "Method Not Allowed",
  "406": "Not Acceptable",
  "407": "Proxy Authentication Required",
  "408": "Request Timeout",
  "409": "Conflict",
  "410": "Gone",
  "411": "Length Required",
  "412": "Precondition Failed",
  "413": "Payload Too Large",
  "414": "Request-URI Too Long",
  "415": "Unsupported Media Type",
  "416": "Requested Range Not Satisfiable",
  "417": "Expectation Failed",
  "418": "I'm a teapot",
  "421": "Misdirected Request",
  "422": "Unprocessable Entity",
  "423": "Locked",
  "424": "Failed Dependency",
  "426": "Upgrade Required",
  "428": "Precondition Required",
  "429": "Too Many Requests",
  "431": "Request Header Fields Too Large",
  "444": "Connection Closed Without Response",
  "451": "Unavailable For Legal Reasons",
  "499": "Client Closed Request",
  "500": "Internal Server Error",
  "501": "Not Implemented",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
  "505": "HTTP Version Not Supported",
  "506": "Variant Also Negotiates",
  "507": "Insufficient Storage",
  "508": "Loop Detected",
  "510": "Not Extended",
  "511": "Network Authentication Required",
  "599": "Network Connect Timeout Error"
};

module.exports.asyncSuccess = (requestId, syncOriginRequestId, result, statusCode, customSuccededMessage) => {
  console.info(`Origin RequestId processed: ${syncOriginRequestId ? (Array.isArray(syncOriginRequestId) ? syncOriginRequestId.join(", ") : syncOriginRequestId ) : "Does not apply."}`);
  module.exports.success(requestId, result, statusCode, customSuccededMessage, true);
};

module.exports.success = (requestId, result, statusCode, customSuccededMessage, asyncMode, omitFromLog) => {

  let succededStatusCodeToReturn = statusCode || (result? result.statusCode : null) || 200;
  let succededResultToReturn = result || {};
  let succededMessageToReturn = customSuccededMessage || "Request succesffuly completed!";

  if (!(succededStatusCodeToReturn >=200 && succededStatusCodeToReturn < 300 && httpStatus[succededStatusCodeToReturn])) {
    console.warn(`The status code ${succededStatusCodeToReturn} passed to success response is invalid or not from class of Successful HTTP status codes (2XX). Changing it to default status code 200.`);
    succededStatusCodeToReturn = 200;
  }

  let logCopySuceededResultToReturn = null;

  if (Array.isArray(omitFromLog) && omitFromLog.length > 0) {
    logCopySuceededResultToReturn = cloneObjForLogging(succededResultToReturn, omitFromLog);
  }

  console.info(`\nSUCCESS:\nMessage: ${succededMessageToReturn}\nStatus: ${succededStatusCodeToReturn} ${httpStatus[succededStatusCodeToReturn]}\nResult: ${JSON.stringify(logCopySuceededResultToReturn || succededResultToReturn)}`);

  // If it is in async mode, no formatted result need to be returned. So, just return void
  // to let Lambda engine knows that it has been completed successfully.
  if (asyncMode === true) {
    return;
  }

  return buildResponse(requestId, succededStatusCodeToReturn, {"data": succededResultToReturn}, succededMessageToReturn);
};

module.exports.asyncFailure = (requestId, syncOriginRequestId, result, statusCode, customFailedMessage) => {
  console.info(`Origin RequestId unprocessed: ${syncOriginRequestId ? (Array.isArray(syncOriginRequestId) ? syncOriginRequestId.join(", ") : syncOriginRequestId ) : "Does not apply."}`);
  module.exports.failure(requestId, result, statusCode, customFailedMessage, true);
};

module.exports.failure = (requestId, result, statusCode, customFailedMessage, asyncMode) => {
  let failedStatusCodeToReturn = statusCode || (result? result.statusCode : null) || 500;
  let failedResultToReturn = result || {};
  let failedMessageToReturn = customFailedMessage || "Request failed.";

  if (!(failedStatusCodeToReturn >=400 && httpStatus[failedStatusCodeToReturn])) {
    console.warn(`The status code ${failedStatusCodeToReturn} passed to failure response is invalid or not from class of Error HTTP status codes (4XX or 5XX). Changing it to default status code 500.`);
    failedStatusCodeToReturn = 500;
  }

  let isErrorObject = false;

  if (failedResultToReturn instanceof Error) {
    isErrorObject = true;
    
    failedResultToReturn = {
      "errorType": failedResultToReturn.errorType || "InternalError", 
      "error": failedResultToReturn.message,
      "causedBy": failedResultToReturn.causedBy
    };
  }

  console.info(`\nFAIL:\nMessage: ${failedMessageToReturn}\nStatus: ${failedStatusCodeToReturn} ${httpStatus[failedStatusCodeToReturn]}\nResult: ${JSON.stringify(failedResultToReturn)}`);

  // If it is in async mode, no formatted result need to be returned. So, just throw an generic error
  // to inform Lambda engine that it has failed, so as to eventually send this failing execution request to 
  // a Dead Letter Queue (DLQ) or to an SNS topic.
  if (asyncMode === true) {
    throw new Error("Failed asynchronous Lambda event processing.");
  }
  
  // If service faces an internal error and it is not in DEV environment, then hide internal details from the world
  if (!isErrorObject || (failedStatusCodeToReturn === 500 && process.env.STAGE.toLowerCase() !== "dev")) {
    failedMessageToReturn = "Request failed.";
    failedResultToReturn = {
      "errorType": "InternalError",
      "error": "An unexpected error has occurred. Please contact the service's adminstrator."
    }
  }

  // If it is not in DEV environment, hide error chain from the world, just if the erro status code is not from Bad Requests category
  if (process.env.STAGE.toLowerCase() !== "dev" && !(failedStatusCodeToReturn >= 400 && failedStatusCodeToReturn < 500)) {
    delete failedResultToReturn.causedBy;
  }

  return buildResponse(requestId, failedStatusCodeToReturn, {"errors": failedResultToReturn}, failedMessageToReturn);
};

module.exports.serveFile = (requestId, fileData, headers, customSuccessMessage) => {
  let succededMessageToReturn = customSuccessMessage || "File found!";
  let succededStatusCodeToReturn = 200;

  if (fileData instanceof Buffer) {
    fileData = fileData.toString('base64');
  }

  if (!(typeof fileData === "string")) {
    throw errorHandlerHelper.error(500, "InvalidFileDigestFormat", "File content digest is not an string.");
  }

  console.info(`\nSUCCESS:\nMessage: ${succededMessageToReturn}\nStatus: ${succededStatusCodeToReturn} ${httpStatus[succededStatusCodeToReturn]}\nResult: ${fileData.substr(0, 30)}...[TRUNCATED]`);
  
  return buildResponse(requestId, 200, fileData, succededMessageToReturn, headers, true);
} 

module.exports.warmup = (lambdaInstanceId) => {
  console.info(`\nWARMUP: Lambda is warm!\nInstanceId: ${lambdaInstanceId}`);
  return;
};

const buildResponse = (requestId, statusCode, result, message, headers, isBase64Encoded) => {
  return {
      "isBase64Encoded": isBase64Encoded || false,
      "statusCode": statusCode,
      "headers": {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true,
        ...(headers || {})
      },
      "body": !(isBase64Encoded === true) 
            ?
              JSON.stringify({
                requestId,
                statusCode,
                "statusText": httpStatus[statusCode],
                message,
                result
              })
            : 
              ((typeof result === "string") ? result : result.toString('base64'))
    };
};

const cloneObjForLogging = (obj, omit) => {
  if (null == obj || "object" != typeof obj) {
    return obj;
  }

  if (!omit || !Array.isArray(omit) || omit.length === 0) {
    return obj;
  }

  let copy = obj.constructor();

  for (var attr in obj) {
      if (obj.hasOwnProperty(attr)) {
        let exceptionProperty = omit.filter((exceptionPath) => {
          const regex = new RegExp("^" + attr + "\\b(\\.){0,1}");
          return exceptionPath.match(regex);
        });

        if (Array.isArray(exceptionProperty) && exceptionProperty.length === 1) {
          copy[attr] = "[OMITTED]";
        } else {
          copy[attr] = obj[attr];
        }
      }
  }
  return copy;
};

