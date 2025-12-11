"use strict";

module.exports = {
    "specs": {
        "defaultClientName": "S2",
        "defaultSubjectIdentityKind": "CPF",
        "enabledProviders": [
            "SOLUTI"
        ],
        "enabledProvidersEnvironments": {
            "SOLUTI": [
                "VAULTID",
                "BIRDID"
            ]
        },
        "shortIdAlphabet": "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$@",
        "allowedIdentityPatterns": [
            "^\\d{11,11}$", //CPF without mask
            "^\\d{3}\x2E\\d{3}\x2E\\d{3}\x2D\\d{2}$" //CPF with mask
        ],
        "availableSubjectAuthorizeParamKindsMap": {
            "IDENTITY": "subjectIdentityNode",
            "BIRTHDATE": "subjectBirthDateNode"
        },
        "allowedDocumentKinds": {
            "EHR": {
                "realm": "private"
            },
            "PRESCRIPTION": {
                "realm": "private"
            },
            "EXAM": {
                "realm": "private"
            },
            "MEDICALREPORT": {
                "realm": "private"
            },
            "ADDENDUM": {
                "realm": "private"
            },
            "MEDICALCERTIFICATE": {
                "realm": "private"
            }
        },
        "enabledCallbackDomains": JSON.parse(process.env.ENABLED_CLIENT_CALLBACK_DOMAINS || "[]"),
        "enabledClientSourceDocumentsOrigins": JSON.parse(process.env.ENABLED_CLIENT_SOURCE_DOCUMENTS_ORIGINS || "[]"),
        "clientSourceDocumentFieldMappings": JSON.parse(process.env.CLIENT_SOURCE_DOCUMENT_FIELD_MAPPINGS || "[]"),
        "jwt": {
            "aud": "digital-signatures.api.drconsulta.com",
            "algorithm": "HS256",
            "defaultExpirationMinutes": 60
        },
        "signatureAttributes": {
            "commitmentTypeIndication": {
                "allowedValues": {
                    "proofOfOrigin": "id-cti-ets-proofOfOrigin",
                    "proofOfReceipt": "id-cti-ets-proofOfReceipt",
                    "proofOfDelivery": "id-cti-ets-proofOfDelivery",
                    "proofOfSender": "id-cti-ets-proofOfSender",
                    "proofOfApproval": "id-cti-ets-proofOfApproval",
                    "proofOfCreation": "id-cti-ets-proofOfCreation"
                },
                "defaultValue": "proofOfApproval"
            }
        }
    }
};