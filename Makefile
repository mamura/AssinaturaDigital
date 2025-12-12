PROJECT_NAME=assinatura-digital
TF_CONTAINER=terraform
LOCALSTACK_CONTAINER=assinatura-localstack
TF_DIR=docker/terraform

# -------------------------------
# 		DOCKER / INFRA			#
# -------------------------------

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

restart:
	make down
	make up

# -------------------------------
# 			TERRAFORM			#
# -------------------------------

tf-init:
	docker compose run --rm \
		--workdir /workspace/$(TF_DIR) \
		$(TF_CONTAINER) init

tf-plan:
	docker compose run --rm \
		--workdir /workspace/$(TF_DIR) \
		$(TF_CONTAINER) plan

tf-apply:
	docker compose run --rm \
		--workdir /workspace/$(TF_DIR) \
		$(TF_CONTAINER) apply -auto-approve

tf-destroy:
	docker compose run --rm \
		--workdir /workspace/$(TF_DIR) \
		$(TF_CONTAINER) destroy -auto-approve

# -------------------------------
#  BUILD DOS ARQUIVOS DA LAMBDA #
# -------------------------------

lambda-zip:
	@echo "Empacotando lambdas..."
	rm -f docker/terraform/assinatura_digital_lambda.zip
	cd src && zip -r ../docker/terraform/assinatura_digital_lambda.zip \
		handlers \
		application \
		domain \
		infrastructure \
		shared \
		>/dev/null
	zip -r docker/terraform/assinatura_digital_lambda.zip \
		node_modules \
		package.json \
		package-lock.json \
		>/dev/null || true
	@echo "Lambdas empacotadas com sucesso!"

lambda-redeploy: lambda-zip tf-apply
	@echo "Lambda reimplantada com sucesso!"

lambda-sync-code:
	@if [ -z "$(FUNC)" ]; then \
		echo "[Error]: Informe o nome da função: make lambda-sync-code FUNC=<nome_da_lambda>"; \
		exit 1; \
	fi
	@echo "(1/3) Empacotando código da Lambda '$(FUNC)'..."
	$(MAKE) lambda-zip
	@echo "(2/3) Copiando pacote ZIP para o container LocalStack..."
	docker cp docker/terraform/assinatura_digital_lambda.zip \
		assinatura-localstack:/tmp/assinatura_digital_lambda.zip
	@echo "(3/3) Atualizando código da Lambda '$(FUNC)' ..."
	docker exec -it assinatura-localstack \
		awslocal lambda update-function-code \
		--function-name $(FUNC) \
		--zip-file fileb:///tmp/assinatura_digital_lambda.zip >/dev/null
	@echo "Código da Lambda '$(FUNC)' atualizado com sucesso!"

# -------------------------------
# 	INVOCAR LAMBDA MANUALMENTE	#
# -------------------------------
invoke-check:
	docker exec -it $(LOCALSTACK_CONTAINER) \
		awslocal lambda invoke \
		--function-name assinatura_digital_lambda \
		/tmp/output.json && \
	docker exec -it $(LOCALSTACK_CONTAINER) cat /tmp/output.json

# -------------------------------
# 			API GATEWAY			#
# -------------------------------

test-api:
	@echo "Testando API Gateway..."
	curl -s -X POST http://localhost:4566/restapis/$(API_ID)/test/_user_request_/signatures/status \
		-d '{"id:"abc"}' | jq

