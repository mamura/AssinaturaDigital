##########################
# IAM Role para Lambda   #
##########################

resource "aws_iam_role" "lambda_exec_role" {
  name = "lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role        = aws_iam_role.lambda_exec_role.name
  policy_arn  = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

}


##########################
# Lambda Function        #
##########################

resource "aws_lambda_function" "check_signature_status" {
  function_name = "check-signature-status"
  role          = aws_iam_role.lambda_exec_role.arn
  handler       = "handlers/checkSignatureStatus.handler"
  runtime       = "nodejs22.x"

  filename = "${path.module}/assinatura_digital_lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/assinatura_digital_lambda.zip")

  environment {
    variables = {
      NODE_ENV = "local"
    }
  }
}

##########################
# API Gateway REST v1    #
##########################
# API raiz
resource "aws_api_gateway_rest_api" "signatures_api" {
  name        = "assinatura-digital-api"
  description = "API REST da Assinatura Digital via LocalStack + Terraform"
}

# /signatures
resource "aws_api_gateway_resource" "signatures" {
  rest_api_id = aws_api_gateway_rest_api.signatures_api.id
  parent_id   = aws_api_gateway_rest_api.signatures_api.root_resource_id
  path_part   = "signatures"
}

# /signatures/status
resource "aws_api_gateway_resource" "signatures_status" {
  rest_api_id = aws_api_gateway_rest_api.signatures_api.id
  parent_id   = aws_api_gateway_resource.signatures.id
  path_part   = "status"
  
}

# Método HTTP GET para /signatures/status
resource "aws_api_gateway_method" "check_signatures_status_get" {
  rest_api_id   = aws_api_gateway_rest_api.signatures_api.id
  resource_id   = aws_api_gateway_resource.signatures_status.id
  http_method   = "GET"
  authorization = "NONE"
}

# Integração proxy API Gateway -> Lambda check_signature_status
resource "aws_api_gateway_integration" "check_signatures_status_integration" {
  rest_api_id = aws_api_gateway_rest_api.signatures_api.id
  resource_id = aws_api_gateway_resource.signatures_status.id
  http_method = aws_api_gateway_method.check_signatures_status_get.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.check_signature_status.invoke_arn
}

# Deployment + Stage
resource "aws_api_gateway_deployment" "signatures_deployment" {
  rest_api_id = aws_api_gateway_rest_api.signatures_api.id
  description = "Deployment inicial da assinatura-digital-api"

  # truque pra forçar novo deployment quando mudam recurso/método/integração
  triggers = {
    redeploy = sha1(jsonencode({
      resource   = aws_api_gateway_resource.signatures_status.id
      method     = aws_api_gateway_method.check_signatures_status_get.id
      integration = aws_api_gateway_integration.check_signatures_status_integration.id
    }))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "signatures_stage" {
  rest_api_id   = aws_api_gateway_rest_api.signatures_api.id
  stage_name    = "dev"
  deployment_id = aws_api_gateway_deployment.signatures_deployment.id
}

##########################
# Permissão Lambda -> API
##########################

resource "aws_lambda_permission" "apigw_invoke_check_signature_status" {
  statement_id  = "AllowAPIGatewayInvokeCheckSignatureStatus"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.check_signature_status.function_name
  principal     = "apigateway.amazonaws.com"

  # permite qualquer método/rota deste API chamar a Lambda
  source_arn = "${aws_api_gateway_rest_api.signatures_api.execution_arn}/*/*"
}