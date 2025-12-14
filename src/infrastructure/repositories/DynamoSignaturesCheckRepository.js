import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

import {
  dynamoClient,
  signaturesCheckTableName,
} from '../aws/dynamoClient.js';

import { SignatureCheck } from '../../domain/entities/signatures/SignatureCheck.js';
import { RequestOrigin } from '../../domain/valueObjects/RequestOrigin.js';
// crie um contrato equivalente, ex: SignatureCheckRepositoryContract
import { SignatureCheckRepositoryContract } from '../../application/contracts/SignatureCheckRepositoryContract.js';

export class DynamoSignaturesCheckRepository extends SignatureCheckRepositoryContract {
  constructor(docClient = dynamoClient, tableName = signaturesCheckTableName) {
    super();
    this.docClient = docClient;
    this.tableName = tableName;
  }

  /**
   * Salva um registro de checagem de status.
   */
  async create(check) {
    const item = this._toItem(check);

    const command = new PutCommand({
      TableName: this.tableName,
      Item: item,
    });

    await this.docClient.send(command);
  }

  /**
   * Busca um registro de checagem por requestId.
   * (Se existir mais de um, este método retorna apenas o último salvo;
   *  se você precisar de histórico completo, pode evoluir para Query).
   */
  async findByRequestId(requestId) {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: { requestId },
    });

    const { Item } = await this.docClient.send(command);
    if (!Item) return null;

    return this._fromItem(Item);
  }

  _toItem(check) {
    return {
      requestId: check.requestId,
      signatureRequestId: check.signatureRequestId,
      signatureShortId: check.signatureShortId,
      checkParameter: check.checkParameter,
      checkResult: check.checkResult,
      requestOrigin: check.requestOrigin
        ? check.requestOrigin.toJSON()
        : null,
    };
  }

  _fromItem(item) {
    return new SignatureCheck({
      requestId: item.requestId,
      signatureRequestId: item.signatureRequestId,
      signatureShortId: item.signatureShortId,
      checkParameter: item.checkParameter,
      checkResult: item.checkResult,
      requestOrigin: item.requestOrigin
        ? RequestOrigin.fromRaw(item.requestOrigin)
        : null,
    });
  }
}
