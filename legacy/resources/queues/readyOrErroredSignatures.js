"use stric";

const sqsQueueHelper = require("../../helpers/sqsQueue");
const errorHandlerHelper = require("../../helpers/errorHandler");

module.exports.sendMessage = async (requestId, data) => {
    try {
        if (requestId && data.clientName && data.documentKind && data.documentCorrelationId) {
            let messageAttributes = {
                "requestId": {
                  "DataType": "String",
                  "StringValue": requestId
                 }
            };
        
            if (data.errorReason) {
                messageAttributes.errorReason = {
                    "DataType": "String",
                    "StringValue": data.errorReason
                };
            }
            
            let messageBody = `${data.clientName}|${data.documentKind}|${data.documentCorrelationId}`;
        
            let queueOptions = {
                "DelaySeconds": 0
            };
    
            let queuedMessageId = await sqsQueueHelper.sendMessage(process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE, messageAttributes, messageBody, queueOptions);
            return queuedMessageId;
        } else {
            throw errorHandlerHelper.error(400, "IncompleteMessageQueueError", `Data sent to queue is incomplete: ${JSON.stringify({"requestId": requestId, ...data})}`);  
        }
    } catch (e) {
        throw errorHandlerHelper.error(500, "MessageQueueError", `There was an error while trying to send a message to queue ${process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE}.`, e); 
    }
};

module.exports.sendMessageBatch = async (dataToQueue) => {
    try {
        if (!Array.isArray(dataToQueue)) {
            throw errorHandlerHelper.error(400, "InvalidParameterError", "Parameter \"dataToQueue\" must be an array."); 
        }

        let treatedQueueEntries = [];
        

        dataToQueue.forEach((entry) => {
            if (entry.requestId && entry.clientName && entry.documentKind && entry.documentCorrelationId) {
                let messageToPush = {
                    "messageId": entry.requestId,
                    "messageAttributes": {
                        "requestId": {
                            "DataType": "String",
                            "StringValue": entry.requestId
                        }
                    },
                    "messageBody": `${entry.clientName}|${entry.documentKind}|${entry.documentCorrelationId}`
                };

                if (entry.errorReason) {
                    messageToPush.messageAttributes.errorReason = {
                        "DataType": "String",
                        "StringValue": entry.errorReason
                    };
                }
                treatedQueueEntries.push(messageToPush);
            } else {
                throw errorHandlerHelper.error(400, "IncompleteMessageQueueError", `Data sent to queue is incomplete: ${JSON.stringify(entry)}`);  
            }
        });

        let queueOptions = {
            "DelaySeconds": 0
        };
    
        let queueMessageBatchResults = await sqsQueueHelper.sendMessageBatch(process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE, treatedQueueEntries, queueOptions);
        return (Array.isArray(queueMessageBatchResults.succeeded) && queueMessageBatchResults.succeeded.length === treatedQueueEntries.length);
    } catch (e) {
        throw errorHandlerHelper.error(500, "MessageQueueError", `There was an error while trying to send a message batch to queue ${process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE}.`, e); 
    }
};

module.exports.getCurrentTotMessages = async () => {
    try {
        let totMessagesInQueue = await sqsQueueHelper.getQueueOccupation(process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE);
        return totMessagesInQueue;
    } catch (e) {
        throw errorHandlerHelper.error(500, "RetrieveTotalQueueMessagesError", `There was an error while trying to retrieve the total number of messages in queue ${process.env.RSRC_READY_OR_ERRORED_SIGNATURES_QUEUE}.`, e); 
    }
};