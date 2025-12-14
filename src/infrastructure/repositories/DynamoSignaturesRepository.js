import { SignaturesRepositoryContract } from "../../application/contracts/SignaturesRepositoryContract.js";
import { dynamoClient, signaturesTableName } from "../aws/dynamoClient.js";
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export class DynamoSignaturesRepository extends SignaturesRepositoryContract
{
  constructor(docClient = dynamoClient, tableName = signaturesTableName)
  {
    super();
    this.docClient = docClient;
    this.tableName = tableName;
  }

  /**
   * Cria um novo registro de assinatura
   * @param {Signature} signature
   */
  async create(signature)
  {
    const item = this._toItem(signature);

    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });

    await this.docClient.send(command);
  }

  /**
   * Busca assinatua por requestId + signerIdentity (chave composta).
   */
  async findByRequestIdAndSigner(requestId, signerIdentity)
  {
    const command = GetCommand({
      TableName: this.tableName,
      Key: {
        requestId,
        signerIdentity,
      },
    });

    const { Item } = await this.docClient.send(command);
    if (!Item) {
      return null;
    }
    
    return this._toEntity(Item);
  }

  /**
   * Busca uma assinatura pelo shortId usando o GSI signatureShortIdIndex
   * Retorna a primeira encontrada
   * @param {*} shortId 
   * @returns 
   */
  async findByShortId(shortId)
  {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "signatureShortIdIndex",
      KeyConditionExpression: "shortId = :shortId",
      ExpressionAttributeValues: {
        ":shortId": shortId,
      },
      Limit: 1,
    });

    const { Items } = await this.docClient.send(command);
    if (!Items || Items.length === 0) {
      return null;
    }

    return this._toEntity(Items[0]);  
  }

  /**
   * Exemplo simples de geração de ShortId 
   */
  async generateShortId()
  {
    const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

    return random.slice(0, 8);
  }

  /**
   * Atualiza campos mutaveis da assinatura.
   * @param {string} requestId 
   * @param {string} signerIdentity 
   * @param {Partial<Signature>} partial
   */
  async update(requestId, signerIdentity, partial)
  {
    const updatableFields = [
      'sts',
      'signedDocument',
      'requesterCallbackSts',
      'providerSignatureId',
      'signerCertificateAlias',
      'signatureType',
      'signaturePolicy',
      'signatureHashAlgorithm',
      'tsaHashAlgorithm',
      'serviceNotificationCallback',
      'tsaServerId',
      'signatureDocumentSource',
      'signerAuthorization',
      'signerAuthorizationExp',
      'replacedBy',
      'signatureSettingsProfileId',
      'adminOnErrorLasNotifiedAt',
      'adminOnErrorNotificationCount',
    ];

    const expressionParts = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    const now = Date.now();
    let willUpdateStsUpdatedAt = false;
    let willUpdateRequesterCallbackStsUpdatedAt = false;

    for (const field of updatableFields) {
      if (typeof partial[field] !== 'undefined') {
        continue;
      }

      expressionParts.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = partial[field];

      if (field === 'sts') {
        willUpdateStsUpdatedAt = true;
      }

      if (field === 'requesterCallbackSts') {
        willUpdateRequesterCallbackStsUpdatedAt = true;
      }
    }

    if (willUpdateStsUpdatedAt) {
      expressionParts.push('#stsUpdatedAt = :stsUpdatedAt');
      expressionAttributeNames['#stsUpdatedAt'] = 'stsUpdatedAt';
      expressionAttributeValues[':stsUpdatedAt'] = now;
    }

    if (willUpdateRequesterCallbackStsUpdatedAt) {
      expressionParts.push(
        '#requesterCallbackStsUpdatedAt = :requesterCallbackStsUpdatedAt',
      );
      expressionAttributeNames['#requesterCallbackStsUpdatedAt'] =
        'requesterCallbackStsUpdatedAt';
      expressionAttributeValues[':requesterCallbackStsUpdatedAt'] = now;
    }

    if (expressionParts.length === 0) {
      return;
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { requestId, signerIdentity },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await this.docClient.send(command);
  }

  /**
   * Entidade -> Item Dynamo
   */
  _toItem(signature)
  {
    return {
      requestId: signature.requestId,
      shortId: signature.shortId,
      signerIdentity: signature.signerIdentity,

      provider: signature.provider,
      environment: signature.environment,

      sts: signature.sts,
      stsUpdatedAt: signature.stsUpdatedAt,

      signerAuthorization: signature.signerAuthorization,
      signerAuthorizationExp: signature.signerAuthorizationExp,
      signerCertificateAlias: signature.signerCertificateAlias,

      unsignedDocument: signature.unsignedDocument,
      signedDocument: signature.signedDocument,

      requesterNotificationCallback: signature.requesterNotificationCallback,
      requesterCallbackSts: signature.requesterCallbackSts,
      requesterCallbackStsUpdatedAt: signature.requesterCallbackStsUpdatedAt,

      providerSignatureId: signature.providerSignatureId,

      signatureType: signature.signatureType,
      signaturePolicy: signature.signaturePolicy,
      signatureHashAlgorithm: signature.signatureHashAlgorithm,
      signatureDocumentSource: signature.signatureDocumentSource,
      signatureAttributes: signature.signatureAttributes,
      signatureSettingsProfileId: signature.signatureSettingsProfileId,

      tsaHashAlgorithm: signature.tsaHashAlgorithm,
      tsaServerId: signature.tsaServerId,

      serviceNotificationCallback: signature.serviceNotificationCallback,

      checkCounter: signature.checkCounter,
      lastCheckAt: signature.lastCheckAt,
      lastCheckRequestId: signature.lastCheckRequestId,

      replacementFor: signature.replacementFor,
      replacedBy: signature.replacedBy,

      adminOnErrorLasNotifiedAt: signature.adminOnErrorLasNotifiedAt,
      adminOnErrorNotificationCount: signature.adminOnErrorNotificationCount,

      requestOrigin: signature.requestOrigin ? signature.requestOrigin.toJSON() : null,
    };
  }

  /**
   * Item Dynamo -> entidade de domínio.
   */
  _fromItem(item)
  {
    return new Signature({
      requestId: item.requestId,
      shortId: item.shortId,
      signerIdentity: item.signerIdentity,

      provider: item.provider,
      environment: item.environment,

      sts: item.sts,
      stsUpdatedAt: item.stsUpdatedAt,

      signerAuthorization: item.signerAuthorization,
      signerAuthorizationExp: item.signerAuthorizationExp,
      signerCertificateAlias: item.signerCertificateAlias,

      unsignedDocument: item.unsignedDocument,
      signedDocument: item.signedDocument,

      requesterNotificationCallback: item.requesterNotificationCallback,
      requesterCallbackSts: item.requesterCallbackSts,
      requesterCallbackStsUpdatedAt: item.requesterCallbackStsUpdatedAt,

      providerSignatureId: item.providerSignatureId,

      signatureType: item.signatureType,
      signaturePolicy: item.signaturePolicy,
      signatureHashAlgorithm: item.signatureHashAlgorithm,
      signatureDocumentSource: item.signatureDocumentSource,
      signatureAttributes: item.signatureAttributes,
      signatureSettingsProfileId: item.signatureSettingsProfileId,

      tsaHashAlgorithm: item.tsaHashAlgorithm,
      tsaServerId: item.tsaServerId,

      serviceNotificationCallback: item.serviceNotificationCallback,

      checkCounter: item.checkCounter,
      lastCheckAt: item.lastCheckAt,
      lastCheckRequestId: item.lastCheckRequestId,

      replacementFor: item.replacementFor,
      replacedBy: item.replacedBy,

      adminOnErrorLasNotifiedAt: item.adminOnErrorLasNotifiedAt,
      adminOnErrorNotificationCount: item.adminOnErrorNotificationCount,

      requestOrigin: item.requestOrigin
        ? RequestOrigin.fromJSON(item.requestOrigin)
        : null,
    });
  }







  async queryByShortId(shortId)
  {
    const params = {
      TableName: this.tableName,
      IndexName: "signatureShortIdIndex",
      KeyConditionExpression: "shortId = :shortId",
      ExpressionAttributeValues: {
        ":shortId": shortId,
      },
      Limit: 2,
    };

    const command   = new QueryCommand(params);
    const { Items } = await this.client.send(command);

    return Items || [];
  }

  async queryByRequestId(requestId)
  {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: "requestId = :requestId",
      ExpressionAttributeValues: {
        ":requestId": requestId,
      },
      Limit: 2,
    };

    const command   = new QueryCommand(params);
    const { Items } = await this.client.send(command);

    return Items || [];
  }

  async incrementCheckCounter(key, checkId, initializeIfMissing)
  {
    const params = {
      TableName: this.tableName,
      Key: {
        requestId: key.requestId,
        signerIdentity: key.signerIdentity,
      },
      UpdateExpression: "SET checkCounter = if_not_exists(checkCounter, :initial) + :inc",
      ExpressionAttributeValues: {
        ":initial": initializeIfMissing ? 0 : 1,
        ":inc": 1,
      },
      ReturnValues: "UPDATED_NEW",
    };

    const command = new UpdateCommand(params);
    await this.client.send(command);
  }

  async findDetailsForStatusCheck(requestId)
  {
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: "requestId = :requestId",
      ExpressionAttributeValues: {
        ":requestId": requestId,
      },
      Limit: 1,
    };

    const { Items } = await this.client.send(new QueryCommand(params));
    return (Items && Items[0]) || null;
  }
}