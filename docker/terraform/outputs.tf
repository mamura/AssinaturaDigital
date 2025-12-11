locals {
  # Base de invocação HTTP do API Gateway REST no LocalStack
  rest_api_base_invoke_url = "http://localhost:4566/restapis/${aws_api_gateway_rest_api.hello_api.id}/${aws_api_gateway_stage.hello_stage.stage_name}/_user_request_"
}

output "lambda_function_name" {
  description = "Nome da Lambda criada"
  value       = aws_lambda_function.hello_lambda.function_name
}

output "rest_api_base_invoke_url" {
  description = "URL base do API Gateway REST (LocalStack)"
  value       = local.rest_api_base_invoke_url
}

output "rest_api_hello_url" {
  description = "URL completa para GET /hello via API Gateway REST (LocalStack)"
  value       = "${local.rest_api_base_invoke_url}/hello"
}
