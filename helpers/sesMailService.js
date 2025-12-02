"use strict";

const errorHandlerHelper = require("./errorHandler");

const AWS = require("aws-sdk");
AWS.config.update({region: process.env.CLOUD_REGION});
const ses = new AWS.SES({apiVersion: '2010-12-01'});

const EMAIL_REGEX = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

module.exports.sendEmail = async (emailParams) => {
  try {
    if (!emailParams) {
      throw errorHandlerHelper.error(400, "InvalidParam", "Parameter \"emailParams\" sent to sendMail routine is invalid.");
    }

    let fromAddress = emailParams.fromAddress && typeof emailParams.fromAddress === "string"  ? [emailParams.fromAddress] : null;
    let bccAddresses = emailParams.bccAddresses && typeof emailParams.bccAddresses === "string" ? emailParams.bccAddresses.split(",") : [];
    let ccAddresses = emailParams.ccAddresses && typeof emailParams.ccAddresses === "string" ? emailParams.ccAddresses.split(",") : [];
    let toAddresses = emailParams.toAddresses && typeof emailParams.toAddresses === "string" ? emailParams.toAddresses.split(",") : [];
    let replyToAddresses = emailParams.replyToAddresses && typeof emailParams.fromAddress === "string" ? emailParams.replyToAddresses.split(",") : [];
    let messageSubject =  emailParams.messageSubject ? emailParams.messageSubject : null;
    let messageSubjectCharset =  emailParams.messageSubjectCharset ? emailParams.messageSubjectCharset : "UTF-8";
    let messageBodyHtml =  emailParams.messageBodyHtml ? emailParams.messageBodyHtml : null;
    let messageBodyHtmlCharset = emailParams.messageBodyHtmlCharset ? emailParams.messageBodyHtmlCharset : "UTF-8";
    let messageBodyText = emailParams.messageBodyText ? emailParams.messageBodyText : null;
    let messageBodyTextCharset =  emailParams.messageBodyTextCharset ? emailParams.messageBodyTextCharset : "UTF-8";

    if (!Array.isArray(fromAddress) || fromAddress.length === 0) {
      throw errorHandlerHelper.error(400, "MissingParam", "Parameter \"fromAddress\" passed to sendMail routine is missing.");
    }

    if ((!Array.isArray(toAddresses) || toAddresses.length === 0) && 
        (!Array.isArray(ccAddresses) || ccAddresses.length === 0) &&
        (!Array.isArray(bccAddresses) || bccAddresses.length === 0)) {
      throw errorHandlerHelper.error(400, "MissingParam", "No recipient (\"toAddresses\", \"ccAddresses\", \"bccAddresses\") was passed to sendMail routine.");
    }

    const emailAddressesSets = [
      'fromAddress',
      'toAddresses',
      'ccAddresses',
      'bccAddresses',
      'replyToAddresses'
    ];

    const validateEmail = function (emailAddr) {
      return EMAIL_REGEX.test(emailAddr);
    };

    let invalidAddresses = [];

    emailAddressesSets.forEach((emailAddrSet) => {
      let emailAddresses = eval(emailAddrSet);

      emailAddresses.forEach((emailAddr) => {
        if (!validateEmail(emailAddr)) {
          invalidAddresses.push(`${emailAddr} (emailAddrSet)`);
        }
      });
    });

    if (invalidAddresses.length > 0) {
      throw errorHandlerHelper.error(400, "InvalidParam", `The following email addresses passed as parameter to sendMail routine are invalid: ${invalidAddresses.join("; ")}.`);
    }

    if (!messageSubject) {
      throw errorHandlerHelper.error(400, "MissingParam", "Parameter \"messageSubject\" is missing for sendMail routine.");
    }

    if (!messageBodyHtml && !messageBodyText) {
      throw errorHandlerHelper.error(400, "MissingParam", "No message body (\"messageBodyHtml\" or \"messageBodyText\") content was passed to sendMail routine.");
    }

    var sesParams = {
      Destination: { /* required */
        BccAddresses: BccAddresses,
        CcAddresses: ccAddresses,
        ToAddresses: toAddresses
      },
      Message: { /* required */
        Body: (() => {
          let msgBody = {};

          if (messageBodyHtml) {
            msgBody.Html = {
              Charset: messageBodyHtmlCharset,
              Data: messageBodyHtml
            }
          }

          if (messageBodyText) {
            msgBody.Text = {
              Charset: messageBodyTextCharset,
              Data: messageBodyText
            }
          }

          return msgBody;
        })(),
        Subject: {
          Charset: messageSubjectCharset,
          Data: messageSubject
        }
      },
      Source: fromAddress, /* required */
      ReplyToAddresses: replyToAddresses || [],
    };

    let messageId = await ses.sendEmail(sesParams).promise();

    return messageId;

  } catch (e) {
      throw errorHandlerHelper.error(500, "SendEmailError", `An error has ocurred while trying to send mail for parameters: ${JSON.stringify(emailParams || {})}`, e);
  }
};
