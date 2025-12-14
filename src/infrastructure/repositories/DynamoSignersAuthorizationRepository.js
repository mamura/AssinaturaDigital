
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamoClient, signersAuthorizationsTableName } from "../aws/dynamoClient";
import { RequestOrigin } from '../../domain/valueObjects/RequestOrigin';

export class DynamoSignerAuthorizationDynamoRepository extends SignersAuthorizationRepositoryContract
{
  constructor(
    docClient = dynamoClient,
    tableName = signersAuthorizationsTableName
  ) {
    super();
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async create (auth)
  {
    const item = this._toItem(auth);

    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });

    await this.docClient.send(command);
  }

  async findByRequestIdAndSigner(requestId, signerIdentity)
  {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        requestId,
        signerIdentity,
      },
    });

    const { Item } = await this.docClient.send(command);
    if (!Item) return null;

    return this._fromItem(Item);
  }

  async update(requestId, signerIdentity, partial)
  {
    const updatableFields = [
      'sts',
      'jti',
      'signerCertificates',
      'stampExpiration',
      'expiresInSeconds',
      'cached',
      'err',
      'environment',
    ];

    const expressionParts           = [];
    const expressionAttributeNames  = {};
    const expressionAttributeValues = {};
    const now                       = Date.now();
    let willUpdateStsUpdatedAt      = false;

    for (const field of updatableFields) {
      if (typeof partial[field] !== 'undefined') { 
        continue;
      }

      expressionParts.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`]   = field;
      expressionAttributeValues[`:${field}`]  = partial[field];

      if (field === 'sts') {
        willUpdateStsUpdatedAt = true;
      }
    }

    if (willUpdateStsUpdatedAt) {
      expressionParts.push(`#stsUpdatedAt = :stsUpdatedAt`);
      expressionAttributeNames[`#stsUpdatedAt`]   = 'stsUpdatedAt';
      expressionAttributeValues[`:stsUpdatedAt`]  = now;
    }

    if (expressionParts.length === 0) {
      return;
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        requestId,
        signerIdentity,
      },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    });

    await this.docClient.send(command); 
  }

  _toItem(auth)
  {
    return {
      requestId: auth.requestId,
      signerIdentity: auth.signerIdentity,

      provider: auth.provider,
      sts: auth.sts,
      stsUpdatedAt: auth.stsUpdatedAt,

      jti: auth.jti,
      expiresInSeconds: auth.expiresInSeconds,
      signerCertificates: auth.signerCertificates,
      stampExpiration: auth.stampExpiration,

      cached: auth.cached,
      environment: auth.environment,
      err: auth.err,
      useCache: auth.useCache,

      requestOrigin: auth.requestOrigin ? auth.requestOrigin.toJSON() : null,
    };
  }

  _fromItem(item)
  {
    return new SignerAuthorization({
      requestId: item.requestId,
      signerIdentity: item.signerIdentity,

      provider: item.provider,
      sts: item.sts,
      stsUpdatedAt: item.stsUpdatedAt,
      
      jti: item.jti,
      expiresInSeconds: item.expiresInSeconds,
      signerCertificates: item.signerCertificates,
      stampExpiration: item.stampExpiration,

      cached: item.cached,
      environment: item.environment,
      err: item.err,
      useCache: item.useCache,

      requestOrigin: item.requestOrigin
        ? RequestOrigin.fromRaw(item.requestOrigin)
        : null,
    });
  }
}