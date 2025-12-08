import { SignaturesRepositoryContract } from "../../application/contracts/SignaturesRepositoryContract.js";
import { dynamoClient, signaturesTableName } from "../aws/dynamoClient.js";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export class DynamoSignaturesRepository extends SignaturesRepositoryContract
{
  constructor()
  {
    super();
    this.client     = dynamoClient;
    this.tableName  = signaturesTableName;
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