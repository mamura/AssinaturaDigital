import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoClient, serviceCacheTableName } from "../aws/dynamoClient";
import { ServiceCacheEntry } from "../../domain/entities/ServiceCacheEntry";
import { ServiceCacheRepositoryContract } from "../../application/contracts/ServiceCacheRepositoryContract";

export class DynamoServiceCacheRepository extends ServiceCacheRepositoryContract
{
  constructor(docClient = dynamoClient, tableName = serviceCacheTableName) {
    super();
    this.docClient = docClient;
    this.tableName = tableName;
  }

  async get(entryKey)
  {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: { entryKey },
    });

    const { Item } = await this.docClient.send(command);
    if (!Item) return null;

    return this._fromItem(Item);
  }

  async put(entry) {
    const item = this._toItem(entry);

    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });

    await this.docClient.send(command);
  }

  async update(entryKey, entryValue) {
    const now = Date.now();

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: { entryKey },
      UpdateExpression: 'SET #entryValue = :entryValue, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#entryValue': 'entryValue',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':entryValue': entryValue,
        ':updatedAt': now,
      },
    });

    await this.docClient.send(command);
  }

  _toItem(entry) {
    return {
      entryKey: entry.entryKey,
      entryValue: entry.entryValue,
      createdAt: entry.createdAt ?? Date.now(),
      updatedAt: entry.updatedAt ?? Date.now(),
    };
  }

  _fromItem(item) {
    return new ServiceCacheEntry({
      entryKey: item.entryKey,
      entryValue: item.entryValue,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

}