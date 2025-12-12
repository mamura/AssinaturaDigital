locals {
  # Base de invocação HTTP do API Gateway REST no LocalStack
  rest_api_base_invoke_url = "http://localhost:4566/restapis/${aws_api_gateway_rest_api.signatures_api.id}/${aws_api_gateway_stage.signatures_stage.stage_name}/_user_request_"
}

output "check_signature_status_url" {
  description = "URL Completa para GET /signatures/status via API Gateway REST (LocalStack)"
  value       = "${local.rest_api_base_invoke_url}/signatures/status"
}

output "rest_api_base_invoke_url" {
  description = "URL base do API Gateway REST (LocalStack)"
  value       = local.rest_api_base_invoke_url
}
