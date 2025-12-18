resource "aws_dynamodb_table" "signatures" {
  name         = var.signatures_table_name
  billing_mode = "PROVISIONED"

  read_capacity  = 5
  write_capacity = 5

  hash_key  = "requestId"
  range_key = "signerIdentity"

  attribute {
    name = "requestId"
    type = "S"
  }

  attribute {
    name = "signerIdentity"
    type = "S"
  }

  attribute {
    name = "shortId"
    type = "S"
  }

  attribute {
    name = "sts"
    type = "S"
  }

  attribute {
    name = "requesterCallbackSts"
    type = "S"
  }

  attribute {
    name = "stsUpdatedAt"
    type = "N"
  }

  # GSI: signatureShortIdIndex
  global_secondary_index {
    name            = "signatureShortIdIndex"
    hash_key        = "shortId"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "sts",
    ]

    read_capacity  = 5
    write_capacity = 5
  }

  # GSI: signatureStsAndStsUpdatedAtIndex
  global_secondary_index {
    name            = "signatureStsAndStsUpdatedAtIndex"
    hash_key        = "sts"
    range_key       = "stsUpdatedAt"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "signerIdentity",
      "provider",
      "signerAuthorizationExp",
      "unsignedDocument",
      "requestOrigin",
      "providerSignatureId",
      "requesterCallbackSts",
      "createdAt",
      "requesterCallbackStsUpdatedAt",
    ]

    read_capacity  = 5
    write_capacity = 5
  }

  # GSI: requesterCallbackStsUpdatedAtIndex
  global_secondary_index {
    name            = "requesterCallbackStsUpdatedAtIndex"
    hash_key        = "requesterCallbackSts"
    range_key       = "stsUpdatedAt"
    projection_type = "INCLUDE"

    non_key_attributes = [
      "signerIdentity",
      "provider",
      "signerAuthorizationExp",
      "unsignedDocument",
      "requestOrigin",
      "providerSignatureId",
      "sts",
      "createdAt",
      "requesterCallbackStsUpdatedAt",
    ]

    read_capacity  = 5
    write_capacity = 5
  }
}

resource "aws_dynamodb_table" "signatures_check" {
  name         = var.signatures_check_table_name
  billing_mode = "PROVISIONED"

  read_capacity  = 5
  write_capacity = 5

  hash_key = "requestId"

  attribute {
    name = "requestId"
    type = "S"
  }
}

resource "aws_dynamodb_table" "signers_authorization" {
  name         = var.signers_authorization_table_name
  billing_mode = "PROVISIONED"

  read_capacity  = 5
  write_capacity = 5

  hash_key  = "requestId"
  range_key = "signerIdentity"

  attribute {
    name = "requestId"
    type = "S"
  }

  attribute {
    name = "signerIdentity"
    type = "S"
  }
}

resource "aws_dynamodb_table" "service_cache" {
  name         = var.service_cache_table_name
  billing_mode = "PROVISIONED"

  read_capacity  = 5
  write_capacity = 5

  hash_key = "entryKey"

  attribute {
    name = "entryKey"
    type = "S"
  }
}
