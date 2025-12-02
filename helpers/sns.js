"use strict";

const errorHandlerHelper = require("./errorHandler");

const AWS = require("aws-sdk");
AWS.config.update({region: process.env.CLOUD_REGION});
const sns = new AWS.SNS({apiVersion: '2010-03-31'});


module.exports.publishToTopic = async (snsParams) => {
  try {
    if (!snsParams) {
      throw errorHandlerHelper.error(400, "InvalidParam", "Parameter \"snsParams\" sent to publishToTopic routine is invalid.");
    }

    let snsMessage = snsParams.snsMessage && typeof snsParams.snsMessage === "string"  ? snsParams.snsMessage : null;
    let snsMessageSubject = snsParams.snsMessageSubject && typeof snsParams.snsMessageSubject === "string"  ? snsParams.snsMessageSubject : null;
    let snsTargetArn = snsParams.snsTargetArn && typeof snsParams.snsTargetArn === "string"  ? snsParams.snsTargetArn : null;
   

    if (!snsMessage) {
      throw errorHandlerHelper.error(400, "MissingParam", "No message (\"snsMessage\") was passed to publishToTopic routine.");
    }

    if (!snsMessageSubject) {
      throw errorHandlerHelper.error(400, "MissingParam", "No subject (\"snsMessageSubject\") was passed to publishToTopic routine.");
    }

    if (!snsTargetArn) {
      throw errorHandlerHelper.error(400, "MissingParam", "No target subscription ARN (\"snsTargetArn\") was passed to publishToTopic routine.");
    }

    var snsParams = {
      Message: snsMessage,
      //PhoneNumber: snsPhoneNumber,
      Subject: snsMessageSubject,
      TargetArn: snsTargetArn,
      //TopicArn: snsTopicArn
    };;

    let messageId = await sns.publish(snsParams).promise();

    return messageId;

  } catch (e) {
      throw errorHandlerHelper.error(500, "PublishSNSTopicError", `An error has ocurred while trying to publish message to SNS Topic for parameters: ${JSON.stringify(snsParams || {})}`, e);
  }
};
