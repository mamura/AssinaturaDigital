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

resource "aws_lambda_function" "hello_lambda" {
  function_name = "hello-terraform-lambda"
  role = aws_iam_role.lambda_exec_role.arn
  handler = "index.handler"
  runtime = "nodejs22.x"

  filename = "${path.module}/../lambda/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../lambda/lambda.zip")

  environment {
    variables = {
      NODE_ENV = "local"
    }
  }
}

##########################
# API Gateway REST v1    #
##########################

resource "aws_api_gateway_rest_api" "hello_api" {
  name        = "hello-rest-api"
  description = "API REST de exemplo via LocalStack + Terraform"
}

resource "aws_api_gateway_resource" "hello_resource" {
  rest_api_id = aws_api_gateway_rest_api.hello_api.id
  parent_id   = aws_api_gateway_rest_api.hello_api.root_resource_id
  path_part   = "hello"
}

resource "aws_api_gateway_method" "hello_get" {
  rest_api_id   = aws_api_gateway_rest_api.hello_api.id
  resource_id   = aws_api_gateway_resource.hello_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "hello_integration" {
  rest_api_id             = aws_api_gateway_rest_api.hello_api.id
  resource_id             = aws_api_gateway_resource.hello_resource.id
  http_method             = aws_api_gateway_method.hello_get.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.hello_lambda.invoke_arn
}

resource "aws_api_gateway_deployment" "hello_deployment" {
  rest_api_id = aws_api_gateway_rest_api.hello_api.id
  description = "Deployment inicial da hello-rest-api"

  # truque pra forçar novo deployment quando mudam recurso/método/integração
  triggers = {
    redeploy = sha1(jsonencode({
      resource   = aws_api_gateway_resource.hello_resource.id
      method     = aws_api_gateway_method.hello_get.id
      integration = aws_api_gateway_integration.hello_integration.id
    }))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "hello_stage" {
  rest_api_id   = aws_api_gateway_rest_api.hello_api.id
  stage_name    = "dev"
  deployment_id = aws_api_gateway_deployment.hello_deployment.id
}

##########################
# Permissão Lambda -> API
##########################

resource "aws_lambda_permission" "allow_apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.hello_lambda.function_name
  principal     = "apigateway.amazonaws.com"

  # permite qualquer método/rota deste API chamar a Lambda
  source_arn = "${aws_api_gateway_rest_api.hello_api.execution_arn}/*/*"
}