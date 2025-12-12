terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true

  endpoints {
    iam          = "http://localstack:4566"
    apigateway   = "http://localstack:4566"
    apigatewayv2 = "http://localstack:4566"
    lambda       = "http://localstack:4566"
    logs         = "http://localstack:4566"
    sts          = "http://localstack:4566"
  }
}