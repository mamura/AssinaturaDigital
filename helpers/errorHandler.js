"use strict";

module.exports.error = (statusCode, errorType, errorMessage, previousErrorInChain) => {
    errorMessage = errorMessage || "An unexpected error has occurred!";
    let serviceError = new Error(errorMessage);
    serviceError.error = errorMessage;
    serviceError.nature = "ServiceError";
    serviceError.statusCode = statusCode || 500;
    serviceError.errorType = errorType || "InternalError";

    if (previousErrorInChain instanceof Error) {
        serviceError.causedBy = {
            "statusCode": previousErrorInChain.statusCode || 500,
            "errorType": previousErrorInChain.errorType || previousErrorInChain.code || "InternalError", 
            "error": previousErrorInChain.message || "Internal Error",
            "causedBy": previousErrorInChain.causedBy
        };

        if (!previousErrorInChain.causedBy) {
            delete serviceError.causedBy.causedBy;
        }
    } else if (Array.isArray(previousErrorInChain)) {
        serviceError.causedBy = {
            "errors": []
        };

        previousErrorInChain.forEach((previsousError) => {
            let currError = {
                "statusCode": previsousError.statusCode || 500,
                "errorType": previsousError.errorType || previsousError.code || "InternalError", 
                "error": previsousError.message || "Internal Error",
                "causedBy": previsousError.causedBy
            };

            if (!currError.causedBy) {
                delete currError.causedBy;
            }

            serviceError.causedBy.errors.push(currError);
        });
    }
    return serviceError;
};