"use strict";

const errorHandlerHelper = require("./errorHandler");
const asn1js = require("asn1js");
const pkijs = require("pkijs");
const ContentInfo = pkijs.ContentInfo;
const SignedData = pkijs.SignedData;

const oidsSignedAttributesAliases = {
    "contentType": "1.2.840.113549.1.9.3",
    "signingTime":  "1.2.840.113549.1.9.5",
    "messageDigest": "1.2.840.113549.1.9.4",
    "policyId": "1.2.840.113549.1.9.16.2.15",
    "id-aa-signingCertificateV2": "1.2.840.113549.1.9.16.2.47",
    "id-aa-ets-commitmentType": "1.2.840.113549.1.9.16.2.16"
};

const digestAlgorithmsMap = {
    "1.3.14.3.2.26": "SHA-1",
    "2.16.840.1.101.3.4.2.1": "SHA-256",
    "2.16.840.1.101.3.4.2.2": "SHA-384",
    "2.16.840.1.101.3.4.2.3": "SHA-512"
};

const contentTypeMap = {
    "1.3.6.1.4.1.311.2.1.4": "Authenticode signing information",
    "1.2.840.113549.1.7.1": "Data content"
};

const rdnMap = {
    "2.5.4.6": "C",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "2.5.4.3": "CN",
    "2.5.4.7": "L",
    "2.5.4.8": "S",
    "2.5.4.12": "T",
    "2.5.4.42": "GN",
    "2.5.4.43": "I",
    "2.5.4.4": "SN",
    "1.2.840.113549.1.9.1": "E-mail"
};

const certificatesOrigins = [
    "issuer",
    "subject"
]

module.exports.getSigningTimeStamp = (signedDocumentContent) => {
    try {
        let signingTimeAttr = getSignedAttributeValue("signingTime", signedDocumentContent);

        if (!(signingTimeAttr instanceof asn1js.UTCTime)) {
            throw errorHandlerHelper.error(409, "InvalidSigningTimeFormat", "Signing time is not a valid UTC date."); 
        }
        
        let signingTimeValue = new Date(Date.UTC(signingTimeAttr.year, signingTimeAttr.month-1, signingTimeAttr.day, signingTimeAttr.hour, signingTimeAttr.minute, signingTimeAttr.second));
        return signingTimeValue.getTime();
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetSigningTimeError", "Failed to retrieve signing time from signature file.", e); 
    }
};

module.exports.getCertificates = (signedDocumentContent, certificatesOriginNode = "subject") => {
    try {
        if (certificatesOrigins.indexOf(certificatesOriginNode) < 0) {
            throw errorHandlerHelper.error(400, "InvalidParameterError", `Origin nodes from which retrieve certificates in signature file must be one of: ${certificatesOrigins.join(",")}.`);
        }

        const signedContentData = loadSignatureContentInfos(signedDocumentContent);

        if (!signedContentData.signerInfos || !Array.isArray(signedContentData.signerInfos) || signedContentData.signerInfos.length === 0)  {
            throw errorHandlerHelper.error(500, "SignerInfosParsingError", "Unable to parse signer infos from binary signed file.");
        }

        if (signedContentData.signerInfos.length > 1) {
            throw errorHandlerHelper.error(409, "UndeterministicSigner", "The signed file has more than on signer. Unable to determine from which one to retrieve certificate."); 
        }
        
        if (!signedContentData.certificates || !Array.isArray(signedContentData.certificates) || signedContentData.certificates.length === 0)  {
            throw errorHandlerHelper.error(500, "CertificateParsingError", "Unable to parse certificate from binary signed file.");
        }

        let crts = [];

        signedContentData.certificates.map((crt) => {
            if (!(crt instanceof pkijs.Certificate)) {
                throw errorHandlerHelper.error(500, "InvalidCertificateNode", "Invalid certificate node in binary signed file.");
            }

            let crtTypesAndValues = crt[certificatesOriginNode].typesAndValues.map((certTypeAndValue) => {
                return {
                    "type": rdnMap[certTypeAndValue.type] || certTypeAndValue.type,
                    "value": certTypeAndValue.value.valueBlock.value
                };
            });

            let crtIssuer = crt.issuer.typesAndValues.map((crtIssuerTypeAndValue) => {
                return {
                    "type": rdnMap[crtIssuerTypeAndValue.type] || crtIssuerTypeAndValue.type,
                    "value": crtIssuerTypeAndValue.value.valueBlock.value
                };
            });

            crts.push(
                {
                    "certificate": crtTypesAndValues,
                    "issuer": crtIssuer
                }
            );
        });

        let crtsArray = (crts  || []).map((crt) => {
            return {
                "certificate": crt.certificate.map((ctrComponents) => {
                    return `${ctrComponents.type}=${ctrComponents.value}`;
                    }).join(", "),
                "issuer": crt.issuer.map((crtIssComponents) => {
                    return `${crtIssComponents.type}=${crtIssComponents.value}`;
                    }).join(", ")
            };
        });

        let certificatesToReturn = [];

        for (let i = 0, totI = crtsArray.length; i < totI; i++) {
            if (crtsArray[i].certificate === crtsArray[i].issuer) {
                certificatesToReturn.push(crtsArray[i].certificate);
                crtsArray.splice(i, 1);
                break;
            }
        }

        while (crtsArray.length > 0) {
            let currCrt = crtsArray.pop();
        
            let issuerIndex = certificatesToReturn.findIndex((crtToReturn) => {
                return crtToReturn === currCrt.issuer;
            });
        
            if (issuerIndex < 0) {
                certificatesToReturn.push(currCrt.certificate);
            } else {
                if (issuerIndex === (certificatesToReturn.length-1)) {
                    certificatesToReturn.push(currCrt.certificate);
               } else {
                    certificatesToReturn.splice(issuerIndex+1, 0, currCrt.certificate);
                }
            }
        }

        return certificatesToReturn;
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetCertificateError", "Failed to retrieve certificates infos from signature file.", e); 
    }
};

module.exports.getNumberOfSigners = (signedDocumentContent) => {
    try {
        const signedContentData = loadSignatureContentInfos(signedDocumentContent);
        
        if (!signedContentData.signerInfos || !Array.isArray(signedContentData.signerInfos) || signedContentData.signerInfos.length === 0)  {
            throw errorHandlerHelper.error(500, "SignerInfosParsingError", "Unable to parse signer infos from binary signed file.");
        }

        return signedContentData.signerInfos.length;

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetNumberOfSignersError", "Failed to determine the number o signers in signature file.", e); 
    }
};

module.exports.getDigestAlgorithms = (signedDocumentContent) => {
    try {
        const signedContentData = loadSignatureContentInfos(signedDocumentContent);
        
        if (!signedContentData.digestAlgorithms || !Array.isArray(signedContentData.digestAlgorithms))  {
            throw errorHandlerHelper.error(500, "DigestAlgorithmParsingError", "Unable to parse digest algorithm information from binary signed file.");
        }

        return signedContentData.digestAlgorithms.map((digestAlgorithm) => {
            if (!(digestAlgorithm instanceof pkijs.AlgorithmIdentifier)) {
                throw errorHandlerHelper.error(500, "InvalidDigestAlgorithmNode", "Invalid digest algorithm node in binary signed file.");
            }

            let algorithmType = digestAlgorithmsMap[digestAlgorithm.algorithmId];

            if (typeof algorithmType === "undefined") {
                algorithmType = digestAlgorithm.algorithmId;
            }

            return algorithmType;
        });
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetDigestAlgorithmsError", "Failed to retrieve digest algorithms from signature file.", e); 
    }
};

module.exports.getEncapsulatedContentInfo = (signedDocumentContent) => {
    try {
        const signedContentData = loadSignatureContentInfos(signedDocumentContent);
        
        if (!signedContentData.encapContentInfo)  {
            throw errorHandlerHelper.error(500, "EncapsulatedContentInfoParsingError", "Unable to parse encapsulated content information from binary signed file.");
        }

        if (!(signedContentData.encapContentInfo instanceof pkijs.EncapsulatedContentInfo) || !signedContentData.encapContentInfo.eContentType) {
            throw errorHandlerHelper.error(500, "InvalidEncapsulatedContentInfoNode", "Invalid encapsulated content information node in binary signed file.");
        }

        return contentTypeMap[signedContentData.encapContentInfo.eContentType] || signedContentData.encapContentInfo.eContentType;

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetEncapsulatedContentInfoError", "Failed to retrieve encapsulated content information from signature file.", e); 
    }
};

module.exports.getSigningTimeStampAndCertificates = (signedDocumentContent, certificatesOriginNode) => {
    try {
        const signedContentData = loadSignatureContentInfos(signedDocumentContent);

        return {
            "signingTimeStamp": module.exports.getSigningTimeStamp(signedContentData),
            "certificates":  module.exports.getCertificates(signedContentData, certificatesOriginNode)
        };
    } catch (e) {
        throw errorHandlerHelper.error(500, "GetSigningTimeAndCertificatesError", "Failed to retrieve signature time and certificates information from signature file.", e); 
    }
};

module.exports.getSignedRawContent = (signedDocumentContent) => {
    try {
        const signedContentData = loadSignatureContentInfos(signedDocumentContent);
        
        if (!signedContentData.encapContentInfo)  {
            throw errorHandlerHelper.error(500, "EncapsulatedContentInfoParsingError", "Unable to parse encapsulated content information from binary signed file.");
        }

        if (!(signedContentData.encapContentInfo instanceof pkijs.EncapsulatedContentInfo) || !signedContentData.encapContentInfo.eContent ||
            !signedContentData.encapContentInfo.eContent.valueBlock || !signedContentData.encapContentInfo.eContent.valueBlock.valueHex) {
            throw errorHandlerHelper.error(500, "InvalidEncapsulatedContentInfoNode", "Invalid encapsulated content information node in binary signed file.");
        }

        return toBuffer(signedContentData.encapContentInfo.eContent.valueBlock.valueHex).toString('utf8');

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetSignedRawContentError", "Failed to retrieve raw content from signature file.", e); 
    }
};

const getSignedAttributeValue = (oidAlias, signedDocumentContent) => {
    try {
        if (!oidAlias || !oidsSignedAttributesAliases[oidAlias]) {
            throw errorHandlerHelper.error(400, "InvalidOidAlias", "Invalid OID passed as argument.");
        }

        const signedContentData = loadSignatureContentInfos(signedDocumentContent);
        
        if (!signedContentData.signerInfos || !Array.isArray(signedContentData.signerInfos) || signedContentData.signerInfos.length === 0)  {
            throw errorHandlerHelper.error(500, "SignerInfosParsingError", "Unable to parse signer infos from binary signed file.");
        }

        if (signedContentData.signerInfos.length > 1) {
            throw errorHandlerHelper.error(409, "UndeterministicSigner", "The signed file has more than on signer. Unable to determine from which one to retrieve signed attribute."); 
        }

        if (!(signedContentData.signerInfos[0] instanceof pkijs.SignerInfo)) {
            throw errorHandlerHelper.error(500, "InvalidSignerInfosNode", "Invalid signer infos node in binary signed file.");
        }

        if (!signedContentData.signerInfos[0].signedAttrs || !signedContentData.signerInfos[0].signedAttrs.attributes || !Array.isArray(signedContentData.signerInfos[0].signedAttrs.attributes) || signedContentData.signerInfos[0].signedAttrs.attributes.length === 0) {
            throw errorHandlerHelper.error(409, "AbsentSignedAttributes", "No signed attribute has been found in signature file."); 
        }

        let singedAttribute = signedContentData.signerInfos[0].signedAttrs.attributes.find((attr) => {
            return attr.type === oidsSignedAttributesAliases[oidAlias];
        });

        if (!singedAttribute) {
            throw errorHandlerHelper.error(404, "SignedAttributeNotFound", `The signed attribute ${oidAlias} has not been found in signature file.`); 
        }

        if (!singedAttribute.values || !Array.isArray(singedAttribute.values) || singedAttribute.values.length > 1) {
            throw errorHandlerHelper.error(409, "InvalidSignedAttributeStructure", `The structure for signed attribute ${oidAlias} is invalid.`); 
        }

        return singedAttribute.values[0];

    } catch (e) {
        throw errorHandlerHelper.error(500, "GetSignedAttributeValueError", "An error has ocurred while retrieving signed attribute value from signature file.", e); 
    }
};

const loadSignatureContentInfos = (signedDocumentContent) => {
    try {
        if (signedDocumentContent instanceof pkijs.SignedData) {
            return signedDocumentContent;
        }

        const asn1 = asn1js.fromBER(toArrayBuffer(signedDocumentContent));
        
        if(asn1.offset === -1) {
            throw errorHandlerHelper.error(500, "SignedFileParsingError", "Unable to parse binary signed file.");
        }

        const signedContentInfo = new ContentInfo({"schema": asn1.result});
        const signedContentData = new SignedData({"schema": signedContentInfo.content});

        return signedContentData;

    } catch (e) {
        throw errorHandlerHelper.error(500, "LoadSignatureContentInfoError", "Something went wrong while extracting signature content info from the signed binary file.", e); 
    }
};

const toBuffer = (binData) => {
    if (binData instanceof Buffer) {
        return binData;
    }

    if (!(binData instanceof ArrayBuffer)) {
        throw errorHandlerHelper.error(500, "InvalidParameterError", "Content is not a valid ArrayBuffer instance."); 
    }
    
    let buf = new Buffer(binData.byteLength);
    let view = new Uint8Array(binData);
    for (var i = 0; i < buf.length; ++i) {
        buf[i] = view[i];
    }
    return buf;
};

const toArrayBuffer = (binData) => {
    if (binData instanceof ArrayBuffer) {
        return binData;
    }

    if (!(binData instanceof Buffer)) {
        throw errorHandlerHelper.error(500, "InvalidParameterError", "Content is not a valid Buffer instance."); 
    }

    var ab = new ArrayBuffer(binData.length);
    var view = new Uint8Array(ab);
    for (var i = 0; i < binData.length; ++i) {
        view[i] = binData[i];
    }
    return ab;
};