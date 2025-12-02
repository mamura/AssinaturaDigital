"use strict";

const errorHandlerHelper = require("./errorHandler");

const AWS = require("aws-sdk");
AWS.config.update({ region: process.env.CLOUD_REGION });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const uuid = require("uuid");

const SQS_SEND_MESSAGE_BATCH_LIMIT = 10;

const SQS_ALLOWED_QUEUE_ATTRIBUTES = [
    "All",
    "Policy",
    "VisibilityTimeout",
    "MaximumMessageSize",
    "MessageRetentionPeriod",
    "ApproximateNumberOfMessages",
    "ApproximateNumberOfMessagesNotVisible",
    "CreatedTimestamp",
    "LastModifiedTimestamp",
    "QueueArn",
    "ApproximateNumberOfMessagesDelayed",
    "DelaySeconds",
    "ReceiveMessageWaitTimeSeconds",
    "RedrivePolicy",
    "FifoQueue",
    "ContentBasedDeduplication",
    "KmsMasterKeyId",
    "KmsDataKeyReusePeriodSeconds"
];

let queuesUrls = {};

module.exports.sendMessage = async (queueName, messageAttributes, messageBody, options) => {
    try {
        let queueUrl = await getQueueUrl(queueName);

        options = options || {};

        let sqsParams = {
            "DelaySeconds": options.DelaySeconds || 5,
            "MessageAttributes": messageAttributes,
            "MessageBody": messageBody,
            "QueueUrl": queueUrl
        };

        let queuedMessage = await sqs.sendMessage(sqsParams).promise();

        return queuedMessage.MessageId;

    } catch (e) {
        throw errorHandlerHelper.error(500, "MessageQueueError", `An error has ocurred while trying to put message on queue ${queueName}`, e);
    }
};

module.exports.sendMessageBatch = async (queueName, queueEntries, options) => {
    try {
        if (!Array.isArray(queueEntries)) {
            throw errorHandlerHelper.error(400, "InvalidParameterError", "Parameter \"queueEntries\" must be an array.");
        }

        let results = {
            "succeeded": [],
            "errored": []
        };

        if (queueEntries.length === 0) {
            return results;
        }

        let queueUrl = await getQueueUrl(queueName);

        options = options || {};

        let promisesSendMessageBatch = [];

        for (let i = 0, totI = queueEntries.length; i < totI; i += SQS_SEND_MESSAGE_BATCH_LIMIT) {
            let sqsParams = {
                "Entries": queueEntries.slice(i, (i + SQS_SEND_MESSAGE_BATCH_LIMIT)).map((queueEntry) => {
                    return {
                        "Id": queueEntry.messageId || uuid.v4(),
                        "DelaySeconds": options.DelaySeconds || 5,
                        "MessageAttributes": queueEntry.messageAttributes,
                        "MessageBody": queueEntry.messageBody,
                    }
                }),
                "QueueUrl": queueUrl
            };

            promisesSendMessageBatch.push(sqs.sendMessageBatch(sqsParams).promise());
        }

        await Promise.all(promisesSendMessageBatch.map((pendingPromise) => {
            return pendingPromise.then((res) => {
                results.succeeded = results.succeeded.concat(res.Successful || []);
                results.errored = results.errored.concat(res.Failed || []);
                return res;
            })
            .catch((e) => {
              console.warn(`An error has occurred while sending batch of up to ${SQS_SEND_MESSAGE_BATCH_LIMIT} messages to queue ${queueName}.`, e);
              results.errored = results.errored.concat([e]);
              return e; 
            });
          })).catch((e) => {
            throw errorHandlerHelper.error(500, "SendMessageBatchError", `An unexpected error has ocurred while sending messages in batch to queue ${queueName}.`, e);
        });

        return results;

    } catch (e) {
        throw errorHandlerHelper.error(500, "MessageQueueError", `An error has ocurred while trying to put message on queue ${queueName}`, e);
    }
};

module.exports.getQueueOccupation = async (queueName) => {
    try {
        let quantityAttributeNames = ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesDelayed", "ApproximateNumberOfMessagesNotVisible"];

        let messageCountAttributes = await getQueueAttributes(queueName, quantityAttributeNames);

        let approximateQuantityOfMessagesInQueue = quantityAttributeNames.reduce((accumulated, currentQuanittyAttributeName) => {
            if (messageCountAttributes[currentQuanittyAttributeName] && Number.isInteger(parseInt(messageCountAttributes[currentQuanittyAttributeName]))) {
                return accumulated + parseInt(messageCountAttributes[currentQuanittyAttributeName]);
            }
            return accumulated;
        }, 0);

        return approximateQuantityOfMessagesInQueue;

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetQueueOccupationError", `Failed to compute occupation of queue ${queueName}`, e);
    }
};

const getQueueAttributes = async (queueName, attributeNames) => {
    try {
        if (typeof attributeNames === "string") {
            if (attributeNames.length > 0) {
                attributeNames = [attributeNames];
            } else {
                throw errorHandlerHelper.error(400, "InvalidParameterError", "Parameter \"attributeNames\" must be a valid non-empty string.");
            }
        } else {
            if (!Array.isArray(attributeNames) || attributeNames.length === 0) {
                throw errorHandlerHelper.error(400, "InvalidParameterError", "Parameter \"attributeNames\" must be a valid non-empty array.");
            }
        }

        let invalidAttributeNames = [];

        attributeNames.forEach((attributeName) => {
            if (SQS_ALLOWED_QUEUE_ATTRIBUTES.indexOf(attributeName) === -1) {
                invalidAttributeNames.push(attributeName);
            }
        });

        if (invalidAttributeNames.length > 0) {
            throw errorHandlerHelper.error(400, "InvalidParameterError", `One or more attributes are not allowed. Invalid attributes: ${invalidAttributeNames.join(", ")}`);
        }

        let queueUrl = await getQueueUrl(queueName);

        let sqsParams = {
            "AttributeNames": attributeNames,
            "QueueUrl": queueUrl
        };

        let result = await sqs.getQueueAttributes(sqsParams).promise();

        return (result || {}).Attributes || {};

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetQueueAttributesError", `An error has ocurred while trying to get attributes from queue ${queueName}`, e);
    }
};

const getQueueUrl = async (queueName) => {
    try {
        if (typeof queueName !== "string" || queueName.length === 0) {
            throw errorHandlerHelper.error(500, "InvalidParam", "Queue name informed is missing or invalid.");
        }

        if (queuesUrls[queueName]) {
            return queuesUrls[queueName];
        }

        let sqsParams = {
            "QueueName": queueName
        };

        let queueUrlResult = await sqs.getQueueUrl(sqsParams).promise();

        queuesUrls[queueName] = queueUrlResult.QueueUrl;

        return queueUrlResult.QueueUrl;

    } catch (e) {
        throw errorHandlerHelper.error(500, "MessageQueueError", `An error has ocurred while retrieving URL for queue ${queueName}`, e);
    }
};