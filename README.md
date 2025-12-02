# Digital Signature Service

## Overview
##
This project provides [AWS Lambda](https://aws.amazon.com/lambda) functions to handle digital signatures. All signatures produced
are in compliance with Brazilian standards defined by the [ITI - Instituto Nacional de Tecnologia da Informação](https://www.iti.gov.br/), so that they have legal validity according to Brazil's [legislation and technical specifications](https://www.iti.gov.br/legislacao).

Initially, signatures are provided only in the CAdES standard under [AD-RT policy](https://www.iti.gov.br/repositorio/85-artefatos-de-assinatura-digital/139-assinatura-digital-com-referencia-de-tempo-ad-rt) from [ICP-Brasil](https://www.iti.gov.br/icp-brasil). Please refer to [DOC-ICP-15](https://www.iti.gov.br/images/repositorio/legislacao/documentos-principais/DOC-ICP-15_-_Versao_3.0_VISAO_GERAL_SOBRE_ASSIN_DIG_NA_ICP-BRASIL_25-08-2015.pdf) for more details on national digital signature standards.

Our signature provider, who is the one responsible for issuing digital certificates, making them available in cloud environment, and processing signatures is [Soluti](https://www.soluti.com.br/).

## Service execution
We are using [Serverless Framework](https://serverless.com/framework/docs/providers/aws/guide/intro/ "AWS - Introduction") for helping us to deploy the project's Lambda functions to our AWS environment. 

For testing the service, open a terminal on project's root directory and run the following command:

```
serverless deploy --stage dev --aws-profile default
```

This command will package project's assets and update the entire project development stack at AWS environment. After that, all Lambda functions will be updated with the new content.

Please, notice that the environment that will be updated is the one your user credentials (defined in configuration file `~/.aws/credentials`). For further details on how to setup your credentials, plese refer to [this link](https://serverless.com/framework/docs/providers/aws/guide/credentials/ "AWS - Credentials").


## Deploying UI view for signed documents validation

The project also encompasses a UI module for users who have a signed document can validate it. The contents for this module are located at directory `/public/signatureStatus`. 

The UI modules does not run as a Lambda function. Instead, it is deployed in a deticated S3 bucket as an Web application, and served by using AWS Cloud Front.

So, whenever you need to update this web application, after making all modification on code, just run the following command at project's root directory:

```
aws s3 cp public/signatureStatus/ s3://dev-signature-status-webapp-bucket/ --recursive
```

This will trigger the update of the web app files at the S3 bucket used to deploy the application. When the bucket contents are updated, Cloud Front automatcially will perform cache invalidation of the cached files so as to start serving the updated contents. This invalidation process may takes a few minutes to be complewted.

*Notice that the steps described above are only for manual tests. In production environment, CodeBuild are in chart to perform these steps for automatically deploying your project in a transparent way* 
