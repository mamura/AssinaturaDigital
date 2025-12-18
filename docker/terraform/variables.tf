variable "aws_region" {
    type        = string
    description = "AWS region"
    default     = "us-east-1"
}

variable "aws_access_key" {
    type        = string
    description = "Access key (use 'test' to LocalStack)"
    default     = "test"
}

variable "aws_secret_key"{
    type        = string
    description = "Secret key (use 'test' to LocalStack)"
    default     = "test"
}

variable "use_localstack" {
    type        = bool
    description = "Whether to use LocalStack endpoints"
    default     = true
}

variable "localstack_endpoint" {
    type        = string
    description = "LocalStack endpoint URL"
    default     = "http://localstack:4566"
}

# Table names
variable "signatures_table_name" {
  type        = string
  description = "Nome da tabela de assinaturas"
  default     = "SignaturesTableLocal"
}

variable "signatures_check_table_name" {
  type        = string
  description = "Nome da tabela de controle de checagens"
  default     = "SignaturesCheckTableLocal"
}

variable "signers_authorization_table_name" {
  type        = string
  description = "Nome da tabela de autorização de signatários"
  default     = "SignersAuthorizationTableLocal"
}

variable "service_cache_table_name" {
  type        = string
  description = "Nome da tabela de cache do serviço"
  default     = "ServiceCacheTableLocal"
}