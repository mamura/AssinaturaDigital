"use strict";

const THEMES = ["Pink", "Yellow", "Green"];

const DOCUMENT_KINDS = {
    "PRESCRIPTION": {
        "label": "Receituário",
        "iconClass": "fas fa-capsules",
        "realm": "private"
    },
    "EXAM": {
        "label": "Solicitação de Exames",
        "iconClass": "fas fa-flask",
        "realm": "private"
    },
    "MEDICALREPORT": {
        "label": "Laudo Médico",
        "iconClass": "fas fa-heartbeat",
        "realm": "private"
    },
    "EHR": {
        "label": "Entradas de Prontuário",
        "iconClass": "fas fa-file-medical",
        "realm": "private"
    },
    "ADDENDUM": {
        "label": "Adendo",
        "iconClass": "fas fa-file-medical",
        "realm": "private"
    },
    "MEDICALCERTIFICATE": {
        "label": "Atestado Médico",
        "iconClass": "fas fa-file-contract",
        "realm": "private"
    }
};

const DOCUMENTS_MIMETYPES = {
    "application/pdf": {
        "iconClass": "far fa-file-pdf",
        "fileExtension": "pdf"
    },
    "text/html": {
        "iconClass": "far fa-file-code",
        "fileExtension": "html"
    }
}

const DEFAULT_MEDIA_TYPE = "application/pdf";

const SUBJECT_AUTHORIZE_PARAM_KINDS = {
    "BIRTHDATE": {
        "code": "BIRTHDATE",
        "label": "Data de Nascimento",
        "placeholder": "Data Nascimento",
        "phrase": "a data de nascimento",
        "iconClass": "fas fa-birthday-cake",
        "inputMask": "99 / 99 / 9999",
        "inputMaskRegex": null,
        "verifyRegex": /^\d{2}\/\d{2}\/\d{4}$/
    },
    "IDENTITY_CPF": {
        "code": "IDENTITY_CPF",
        "label": "CPF",
        "placeholder": "CPF",
        "phrase": "o CPF",
        "iconClass": "far fa-id-card",
        "inputMask": "999 . 999 . 999 - 99",
        "inputMaskRegex": "\\\\d{3}\\\\.\\\\d{3}\\\\.\\\\d{3}\\\\-\\\\d{2}",
        "verifyRegex": /^\d{3}\.\d{3}\.\d{3}\-\d{2}$/
    },
    "IDENTITY_RG": {
        "code": "IDENTITY_RG",
        "label": "RG",
        "placeholder": "RG",
        "phrase": "o RG",
        "iconClass": "far fa-id-card",
        "inputMask": null,
        "inputMaskRegex": "([0-9A-Z]){9,15}",
        "verifyRegex": /^([0-9A-Z]){9,15}$/
    },
    "IDENTITY_CERTIDAO_DE_NASCIMENTO": {
        "code": "IDENTITY_CERTIDAO_DE_NASCIMENTO",
        "label": "Certidão de Nascimento",
        "placeholder": "Nº. Certidão",
        "phrase": "o número da certidão de nascimento",
        "iconClass": "far fa-id-card",
        "inputMask": null,
        "inputMaskRegex": "[0-9A-Za-z]{4,10}",
        "verifyRegex": /^[0-9A-Za-z]{4,10}$/
    },
    "IDENTITY_PASSAPORTE": {
        "code": "IDENTITY_PASSAPORTE",
        "label": "Passaporte",
        "placeholder": "Passaporte",
        "phrase": "o passaporte",
        "iconClass": "far fa-id-card",
        "inputMask": null,
        "inputMaskRegex": "[A-Z0-9]{8,12}",
        "verifyRegex": /^[A-Z0-9]{8,12}$/
    }
};

const DEFAULT_SUBJECT_AUTHORIZE_PARAM_KIND = "BIRTHDATE";

Inputmask.extendDefinitions({
    '#': {
        validator: "[A-Za-z0-9$@]",
        cardinality: 1
    }
});

const VERIFIER_KEY_REGEX = /^[A-Za-z0-9$@]{9}\.[A-Za-z0-9$@]{7}$/; 
const URI_REGEX = /[a-zA-Z][-\w+.]+:\/\/(\w+:.+@)?[^ "<>@]+(:[0-9]+)?\/?(\w*)?\/?(\?\w+)?(#\w)?/;

$.validator.addMethod(
    "regex",
    (value, element, regexp) => {
        return value.match(typeof regexp == 'string' ? new RegExp(regexp) : regexp);
    },
    "Please enter a value in the correct format."
);

const renderPreLoader = () => {
    $("#status").delay(500).fadeOut();
    $("#preloader").delay(200).fadeOut("slow");
    $("body").delay(600).css({ "overflow": "visible" });
};

const configViewLayout = () => {
    const selectedTheme = THEMES[Math.floor(Math.random()*THEMES.length)];

    $("#panelResult").hide();
    $("#panelRequestInfo").hide();
    $("#panelPrintButton").hide();

    $("#spinLoading").addClass(`loadingGde${selectedTheme}`);
    $("#imgLogo").addClass(`logo${selectedTheme}`);
    $("#btnSubmitVerifyDocument").addClass(`button${selectedTheme}`);
    $("#appNameContainer").addClass(selectedTheme);

    let footerIconSrc = "assets/css/drc-base/images/";

    switch (selectedTheme) {
        case "Pink":
            footerIconSrc += "logo-secundario-pink-reduzido.svg";
            break;   
        case "Yellow":
            footerIconSrc += "logo-secundario-yellow-reduzido.svg";
            break;
        case "Green":
        default:
            footerIconSrc += "logo-default-reduzido.svg";
    }

    $("#footerLogoIcon").attr("src", footerIconSrc);
};

const attachFormVerifyDocumentValitation = () => {
    const formVerifyDocument = $("#formVerifyDocument");

    formVerifyDocument.validate({ 
        errorPlacement: function(error, element) {},
        rules: {
            verifierKey: {
                required: true,
                regex: VERIFIER_KEY_REGEX,
                normalizer: (value) => {
                    return value.replace(/\s|\_/g, "");
                }
            }
        }
    });

    formVerifyDocument.submit((event) => {
        event.preventDefault();
        if (formVerifyDocument.valid() !== false) {
            callCheckSignatureService($("#verifierKey").val().replace(/\s|\_/g, ""));
            return false;
        }
    });

    $("#btnSubmitVerifyDocument").click(() => {
        formVerifyDocument.submit();
    })
};

const getUrlParameter = (sParam) => {
    let sPageURL = window.location.search.substring(1),
        sURLVariables = sPageURL.split("&"),
        sParameterName,
        i,
        totI;

    for (i = 0, totI = sURLVariables.length; i < totI; i++) {
        sParameterName = sURLVariables[i].split("=");

        if (sParameterName[0] === sParam) {
            return sParameterName[1] === undefined ? true : decodeURIComponent(sParameterName[1]);
        }
    }
};

const clearResults = () => {
    $("#panelResult").hide();
    $("#panelRequestInfo").hide();
    $("#resultVerifyDocumentBody").empty();
    $("#panelRequestInfoBody").empty();
    $("#resultVerifyDocumentWrapper").removeClass("alertErro alertAtencao alertSucesso");
    $("#panelResult").removeClass("valid");
    $("#btnShowRawContent").empty();
    $("#modalViewSourceDocumentBody").empty();
    $("#viewSourceDocumentToogle").empty();
    $("#checkSubjectData").empty();
    $("#panelPrintButton").hide();
    $("#panelPrintButton").hide();
    $("#btnPrint").off("click");

    $("#verifierKey").prop("readonly", false);
    $("#btnSubmitVerifyDocument").prop("disabled", false);
    $("#btnSubmitVerifyDocument").css("cursor", "pointer");
    $("#btnSubmitVerifyDocument").prop("title", "Verificar Documento");
};

const formatDateFromTimeStamp = (ts) => {
    let d = new Date(typeof ts !== "undefined" ? ts : Date.now());
    let dateString =
        ("0" + d.getDate()).slice(-2) + "/" +
        ("0" + (d.getMonth()+1)).slice(-2) + "/" + 
        ("0" + d.getFullYear()).slice(-2) +  " às " +
        ("0" + d.getHours()).slice(-2) + ":" +
        ("0" + d.getMinutes()).slice(-2) + ":" +
        ("0" + d.getSeconds()).slice(-2);
    return dateString;
};

const showErrorResult = () => {
    $("#resultVerifyDocumentWrapper").addClass("alertErro");
    $("#resultVerifyDocumentIcon").attr("src","assets/css/drc-base/images/icons/branco-com-azul/knife.svg");
    $("#resultVerifyDocumentIcon").attr("alt","Erro");
    $("#resultVerifyDocumentTitle").html("Erro");
    $("#resultVerifyDocumentBody").append($("<p></p>").text("Houve uma falha ao tentar verificar o documento. Por favor, tente novamente."));
    $("#panelResult").fadeIn("fast");

    setTimeout(() => {  $("#verifierKey").focus(); }, 500);

    hideLoader();
};

const showNotFoundResult = (verifierKey) => {
    $("#resultVerifyDocumentWrapper").addClass("alertAtencao");
    $("#resultVerifyDocumentIcon").attr("src","assets/css/drc-base/images/icons/rosa-com-azul/not-found.svg");
    $("#resultVerifyDocumentIcon").attr("alt","Documento não encontrado");
    $("#resultVerifyDocumentTitle").html("Documento não encontrado");
    $("#resultVerifyDocumentBody").append($("<p></p>").html(`<b>Chave de verificação: </b>${verifierKey}`));
    $("#resultVerifyDocumentBody").append($("<p></p>").text("Nenhum documento foi localizado para a chave de verificação informada."));
    
    preparePanelRequestInfo();

    $("#panelResult").fadeIn("fast");
    $("#panelRequestInfo").fadeIn("fast");

    setTimeout(() => {  $("#verifierKey").focus(); }, 500);

    hideLoader();
};

const showReplacementResult = (verifierKey, replacementVerifierKey, authenticityCode, verifyingTimeStamp) => {
    $("#resultVerifyDocumentWrapper").addClass("alertSucesso2");
    $("#resultVerifyDocumentIcon").attr("src","assets/css/drc-base/images/icons/amarelo-com-azul/calendar-atention.svg");
    $("#resultVerifyDocumentIcon").attr("alt","Dccumento substituído");
    $("#resultVerifyDocumentTitle").html("Documento substituído");
    $("#resultVerifyDocumentBody").append($("<p></p>").html(`<b>Chave de verificação: </b>${verifierKey}`));

    let windowHrefSplit = window.location.href && window.location.href.split("key=");
    let verifyReplacementLocation = null;
    if (Array.isArray(windowHrefSplit)) {
        windowHrefSplit.pop();
        verifyReplacementLocation = windowHrefSplit.join("") + "key=" + (replacementVerifierKey || "");
    }

    $("#resultVerifyDocumentBody").append($("<p></p>").html(`O documento é válido, porém foi substituído por uma versão mais recente. <a href="${verifyReplacementLocation ? verifyReplacementLocation : "#"}" target="_self" title="Validar documento substituto" style="font-weight: bolder;">Clique aqui</a> para validá-lo.`));
    $("#panelResult").fadeIn("fast");

    preparePanelRequestInfo(authenticityCode, verifyingTimeStamp);

    $("#panelResult").fadeIn("fast");
    $("#panelRequestInfo").fadeIn("fast");

    setTimeout(() => {  $("#verifierKey").focus(); }, 500);

    hideLoader();
};

const showInvalidResult = (verifierKey, authenticityCode, verifyingTimeStamp) => {
    $("#resultVerifyDocumentWrapper").addClass("alertErro");
    $("#resultVerifyDocumentIcon").attr("src","assets/css/drc-base/images/icons/branco-com-azul/fail.svg");
    $("#resultVerifyDocumentIcon").attr("alt","Documento inválido");
    $("#resultVerifyDocumentTitle").html("Documento inválido");
    $("#resultVerifyDocumentBody").append($("<p></p>").html(`<b>Chave de verificação: </b>${verifierKey}`));
    $("#resultVerifyDocumentBody").append($("<p></p>").html("O documento consta como existente, porém a assinatura é inválida."));
    
    preparePanelRequestInfo(authenticityCode, verifyingTimeStamp);

    $("#panelResult").fadeIn("fast");
    $("#panelRequestInfo").fadeIn("fast");

    setTimeout(() => {  $("#verifierKey").focus(); }, 500);

    hideLoader();
}; 

const prepareSourceDocumentFilesView = (verifierKey, sourceDocumentFiles, currentDocumentKindLabel, currentDocumentKindIcon, subjectAuthorize) => {
    let hasPDFSuport = browserHasPDFSupport();
    sourceDocumentFiles = sourceDocumentFiles || {};

    $("#viewSourceDocumentToogle").css("cursor", "unset");
    $("#viewSourceDocumentToogle").addClass("Purple");

    if (sourceDocumentFiles.status === "PRIVATE" || sourceDocumentFiles.status === "UNAUTHORIZED") {
        $("#verifierKey").prop("readonly", true);
        $("#btnSubmitVerifyDocument").prop("disabled", true);
        $("#btnSubmitVerifyDocument").css("cursor", "not-allowed");

        if (!subjectAuthorize || !subjectAuthorize.paramKind) {
            $(`<i class=\"fas fa-lock\"></i> <span>O arquivo assinado é privado e não pode ser visualizado neste momento.</span>`)
                .appendTo("#viewSourceDocumentToogle");
                $("#viewSourceDocumentToogle i").addClass("Purple");
        } else {
            let subjectAuthorizeParamSpecs = SUBJECT_AUTHORIZE_PARAM_KINDS[subjectAuthorize.paramKind.replace("|", "_").replace(/\s/g, "_").toUpperCase()] || SUBJECT_AUTHORIZE_PARAM_KINDS[DEFAULT_SUBJECT_AUTHORIZE_PARAM_KIND];
            $("#btnSubmitVerifyDocument").prop("title", `Documento verificado. Confirme ${subjectAuthorizeParamSpecs.phrase} do paciente caso queira visualizar o(s) arquivo(s) associado(s) ao documento assinado.`);    
            $("#viewSourceDocumentToogle").addClass("noPrintable"); 
            
            if (sourceDocumentFiles.status === "UNAUTHORIZED") {
                $("<div style=\"color: #ca4242 !important;\"> <i style=\"color: #ca4242 !important;\" class=\"fas fa-times-circle\"></i> O valor informado é inválido. Tente novamente.</div>").appendTo("#viewSourceDocumentToogle");         
            }
            
            $(`<i class=\"fas fa-lock\"></i> <span>Confirme <span style=\"font-style: italic;\">${subjectAuthorizeParamSpecs.phrase}</span> do paciente para visualizar o(s) arquivo(s):</span>`)
                .appendTo("#viewSourceDocumentToogle");
            $("#viewSourceDocumentToogle i").addClass("Purple");
     
            $("#checkSubjectData").append(`<div class="form-row align-items-center">
                                                <form id="formVerifyDocumentWithSubjectCheck" method="POST" novalidate autocomplete="off">
                                                    <div style="margin-left: 10px;" class="row">
                                                        <label class="sr-only" for="subjectAuthorize-${subjectAuthorizeParamSpecs.code}">${subjectAuthorizeParamSpecs.label}</label>
                                                        <div class="input-group">
                                                            <div class="input-group-prepend" style="margin-bottom: 8px; margin-right: -12px !important;">
                                                                <div class="input-group-text" style="padding-left: 6px !important; padding-right: 16px !important;"><i class=\"${subjectAuthorizeParamSpecs.iconClass}\"></i></div>
                                                            </div>
                                                            <input style="font-size: 12px; width: 145px" type="text" class="form-control inputSmall mb-2" id="subjectAuthorize-${subjectAuthorizeParamSpecs.code}" name="subjectAuthorize-${subjectAuthorizeParamSpecs.code}" placeholder="${subjectAuthorizeParamSpecs.placeholder}" data-inputmask="${subjectAuthorizeParamSpecs.inputMask ? (`'mask': '${subjectAuthorizeParamSpecs.inputMask}'`) : (`'regex': '${subjectAuthorizeParamSpecs.inputMaskRegex}'`)}" autofocus required>
                                                            <i id="btnSubmitVerifyDocumentWithSubjectCheck" class="fas fa-chevron-circle-right" style="color:#ffffff; vertical-align: middle; font-size: 30px; margin-left: 5px; margin-top: 4px; cursor: pointer;" title="Verificar"></i>
                                                        </div>
                                                    </div>
                                                </form>
                                            </div>`);
            
            setTimeout(() => { $(`#subjectAuthorize-${subjectAuthorizeParamSpecs.code}`).focus() }, 500);

            $(`#subjectAuthorize-${subjectAuthorizeParamSpecs.code}`).inputmask();
            
            if (typeof subjectAuthorize.paramValue === "string") {
                if (subjectAuthorizeParamSpecs.code === "BIRTHDATE" && subjectAuthorize.paramValue.length === 8) {
                    subjectAuthorize.paramValue = `${subjectAuthorize.paramValue.substring(6)}${subjectAuthorize.paramValue.substring(4,6)}${subjectAuthorize.paramValue.substring(0,4)}`;
                }
                $(`#subjectAuthorize-${subjectAuthorizeParamSpecs.code}`).val(subjectAuthorize.paramValue);
            }

            let checkRule = {};
            checkRule[`subjectAuthorize-${subjectAuthorizeParamSpecs.code}`] = {
                required: true,
                regex: subjectAuthorizeParamSpecs.verifyRegex,
                normalizer: (value) => {
                    return value.replace(/\s|\_/g, "");
                }
            }

            $("#formVerifyDocumentWithSubjectCheck").validate({ 
                errorPlacement: function(error, element) {},
                rules: checkRule
            });

            $("#formVerifyDocumentWithSubjectCheck").submit((event) => {
                event.preventDefault();
                if ($("#formVerifyDocumentWithSubjectCheck").valid() !== false) {
                    $("#verifierKey").val(verifierKey);
                    let inputSubjectCheckValue = $(`#subjectAuthorize-${subjectAuthorizeParamSpecs.code}`).val().replace(/\s|\_|\.|\-|\//g, "");
                    if (subjectAuthorizeParamSpecs.code === "BIRTHDATE") {
                        inputSubjectCheckValue = `${inputSubjectCheckValue.substring(4)}${inputSubjectCheckValue.substring(2,4)}${inputSubjectCheckValue.substring(0,2)}`
                    }
                    callCheckSignatureService(verifierKey, subjectAuthorize.paramKind, inputSubjectCheckValue);
                }
            });
            
            $("#btnSubmitVerifyDocumentWithSubjectCheck").click(() => {
                $("#formVerifyDocumentWithSubjectCheck").submit();
            });

            $("#checkSubjectData").show();
        }
    } else if (sourceDocumentFiles.status === "FETCHED") {
        if (Array.isArray(sourceDocumentFiles.files)) {
            if (sourceDocumentFiles.files.length === 0) {
                $(`<i class=\"fas fa-exclamation-triangle\"></i> <span>Nenhum arquivo disponível para visualização.</span>`)
                    .appendTo("#viewSourceDocumentToogle");
                $("#viewSourceDocumentToogle i").addClass("Purple");
            } else {
                let label = "Arquivos disoníveis:";
     
                if (sourceDocumentFiles.files.length === 1) {
                    label = "Arquivo disponível:";
                }

                $(`<i class=\"fas fa-check-circle\"></i> <span>${label}</span>`)
                    .appendTo("#viewSourceDocumentToogle");
                $("#viewSourceDocumentToogle i").addClass("Purple");

                let totFileWithDownloadError = 0;

                sourceDocumentFiles.files.forEach((file) => {
                    if (typeof file === "string" && file === "DOWNLOAD_ERROR") {
                        totFileWithDownloadError++;
                        return;
                    }

                    if ((file.isFileAvailable === undefined || file.isFileAvailable === true) && file.fileContent !== null) {
                        $("#viewSourceDocumentToogle").append($(`<p style=\"margin-top: 5px; margin-left: 5px;\"><i class=\"${((typeof DOCUMENTS_MIMETYPES[file.mediaType] !== "undefined") ? DOCUMENTS_MIMETYPES[file.mediaType].iconClass : "fas fa-file-medical-alt")}\"></i> <a class="sourceDocumentFileToogle" id=\"viewSourceDocumentToogleTrigger-${(file.fileName || verifierKey).replace(/[\.$@]+/gi, '_')}\" href=\"data:${file.mediaType || DEFAULT_MEDIA_TYPE};headers=filename%3D${encodeURIComponent(file.fileName)};base64,${file.fileContent}\" target=\"_blank\" role=\"link\" title=\"${file.fileTitle}\" data-type=\"${file.mediaType || DEFAULT_MEDIA_TYPE}\" download=\"${file.fileName}\">${file.fileTitle}</a></p>`));
                    } else {
                        if (file.invalidAcceptableMediaType === true) {
                            $("#viewSourceDocumentToogle").append($(`<p style=\"margin-top: 5px; margin-left: 5px;\"><i class=\"${((typeof DOCUMENTS_MIMETYPES[file.mediaType] !== "undefined") ? DOCUMENTS_MIMETYPES[file.mediaType].iconClass : "fas fa-file-medical-alt")}\"></i> ${file.fileTitle} <small><b>(visualização indisponível)</b></small></p>`));
                        } else {
                            $("#viewSourceDocumentToogle").append($(`<p style=\"margin-top: 5px; margin-left: 5px;\"><i class=\"${((typeof DOCUMENTS_MIMETYPES[file.mediaType] !== "undefined") ? DOCUMENTS_MIMETYPES[file.mediaType].iconClass : "fas fa-file-medical-alt")}\"></i> ${file.fileTitle} <small><b>${file.fileAvailableAt ? `(visível a partir de ${formatDateFromTimeStamp(file.fileAvailableAt)})` : `(visualização indisponível)`}</b></small></p>`));
                        }
                    }
                });

                $(".sourceDocumentFileToogle").click((event) => {
                    if (event.currentTarget.attributes['data-type'].value === "application/pdf" && hasPDFSuport === true) {
                        event.preventDefault();
                        $("#sourceDocument").remove();
                        $("#modalViewSourceDocumentTitle").empty();
                        $("#modalViewSourceDocumentTitle").html(`<i class="${currentDocumentKindIcon} noPrintable"></i> ${currentDocumentKindLabel} - ${event.currentTarget.title}`);
                        $("#modalViewSourceDocumentBody").html($(`<embed id=\"sourceDocument\" type=\"${event.currentTarget.attributes['data-type'].value}\" target=\"_blank\" />`)
                            .attr('src', event.currentTarget.href));
                        $("#modalViewSourceDocument").modal();
                    }
                });

                if (sourceDocumentFiles.files.length === 1 && totFileWithDownloadError === 0) {
                    $(`#viewSourceDocumentToogleTrigger-${(sourceDocumentFiles.files[0].fileName || verifierKey).replace(/[\.$@]+/gi, '_')}`).click();
                }

                if (totFileWithDownloadError > 0) {
                    if (totFileWithDownloadError > 1) {
                        $("#viewSourceDocumentToogle").append($(`<i style=\"color: #ca4242 !important; margin-top: 5px; margin-left: 5px;\" class=\"fas fa-exclamation-circle\"></i> <span style=\"color: #ca4242 !important;\">Existem ${totFileWithDownloadError} arquivos que não puderam ser recuperados devido a falha.</span>`));
                    } else {
                        $("#viewSourceDocumentToogle").append($(`<i style=\"color: #ca4242 !important; margin-top: 5px; margin-left: 5px;\" class=\"fas fa-exclamation-circle\"></i> <span style=\"color: #ca4242 !important;\">Existe um arquivo que não pôde ser recuperado devido a falha.</span>`));
                    }
                    
                    $("#viewSourceDocumentToogle").append($("<span class=\"noPrintable\" id=\"retryFetchFiles\" style=\"font-size: 14px; color: #dddddd; cursor: pointer; display: block;\">&nbsp;&nbsp;&nbsp;<i style=\"font-size: smaller; color: #dddddd;\" class=\"fas fa-sync-alt\"></i> Tentar novamente</span>"));
                    $("#retryFetchFiles").click(() => {
                        callCheckSignatureService(verifierKey, subjectAuthorize.paramKind, subjectAuthorize.paramValue);
                    });
                }
            }
        } else {
            $(`<i class=\"fas fa-exclamation-triangle\"></i> <span>Nenhum arquivo disponível para visualização.</span>`)
                .appendTo("#viewSourceDocumentToogle");
        }
    } else { //if (sourceDocumentFiles.status === "ERROR") {
        $(`<i class=\"fas fa-times-circle\"></i> <span>Arquivo(s) temporariamente indisponível(is).</span>`)
            .appendTo("#viewSourceDocumentToogle");
        $("#viewSourceDocumentToogle").css("cursor", "unset");
        $("#viewSourceDocumentToogle").addClass("Purple");
        $("#viewSourceDocumentToogle i").addClass("Purple");
        $("#viewSourceDocumentToogle").append($("<span class=\"noPrintable\" id=\"retryFetchFiles\" style=\"font-size: 14px; color: #dddddd; cursor: pointer; display: block;\">&nbsp;&nbsp;&nbsp;<i style=\"font-size: smaller; color: #dddddd;\" class=\"fas fa-sync-alt\"></i> Tentar novamente</span>"));
        $("#retryFetchFiles").click(() => {
            callCheckSignatureService(verifierKey, subjectAuthorize.paramKind, subjectAuthorize.paramValue);
        });
    }
    
    $("#viewSourceDocumentToogle").show();
}

const base64ToBlob = (base64, mimetype, slicesize) => {
    if (!window.atob || !window.Uint8Array) {
        return null;
    }

    mimetype = mimetype || '';
    slicesize = slicesize || 512;

    var bytechars = atob(base64);

    var bytearrays = [];

    for (var offset = 0; offset < bytechars.length; offset += slicesize) {
        var slice = bytechars.slice(offset, offset + slicesize);
        var bytenums = new Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
            bytenums[i] = slice.charCodeAt(i);
        }
        var bytearray = new Uint8Array(bytenums);
        bytearrays[bytearrays.length] = bytearray;
    }
    return new Blob(bytearrays, {type: mimetype});
};

const ucEachWord = (str) => {
    const stopWords = [
        "do",
        "dos",
        "da",
        "das",
        "de",
        "e"
    ];
    let  splitStr = str.toLowerCase().split(' ');
    for (let i = 0; i < splitStr.length; i++) {
        if (splitStr[i].length > 1 && stopWords.indexOf(splitStr[i].toLowerCase()) < 0) {
            splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1);   
        }
    }
    return splitStr.join(' '); 
};

const showValidResult = (documentRealm, verifierKey, documentType, authenticityCode, verifyingTimeStamp, signingTimeStamp, signerName, subjectName, certificates, rawContent, sourceDocumentFiles, subjectAuthorize) => { 
    $("#resultVerifyDocumentWrapper").addClass("alertSucesso");
    $("#resultVerifyDocumentIcon").attr("src","assets/css/drc-base/images/icons/amarelo-com-azul/book-ok.svg");
    $("#resultVerifyDocumentIcon").attr("alt","Documento válido");
    $("#resultVerifyDocumentTitle").html("Documento válido");

    let documentKind = DOCUMENT_KINDS[documentType] || {};
    documentKind.realm = documentRealm || documentKind.realm; // use the realm returned by API (if present); otherwise use the one set on local constant
    let documentKindLabel = documentKind.label || "Documento Médico";
    let documentKindIcon = documentKind.iconClass || "fas fa-file-medical-alt";

    $("#resultVerifyDocumentBody").append($("<h5 id=\"documentTypeLabel\"></h5>").html(`<i class="${documentKindIcon} noPrintable"></i> ${documentKindLabel}`));
    $("#resultVerifyDocumentBody").append($("<div id=\"viewSourceDocumentToogle\" style=\"display: none;\"></div>"));
    $("#resultVerifyDocumentBody").append($("<div id=\"checkSubjectData\" style=\"display: none;\" class=\"noPrintable\"></div>"));
    $("#resultVerifyDocumentBody").append($("<p></p>").html(`<b>Chave de verificação: </b>${verifierKey}`));

    const formattedSigningTime = formatDateFromTimeStamp(signingTimeStamp);

    $("#resultVerifyDocumentBody").append($("<p></p>").html(`<b>Data da assinatura: </b>${formattedSigningTime}`));
    
    if (signerName) {
        $("#resultVerifyDocumentBody").append($("<p id=\"signerName\"></p>").html(`<b>Assinado por: </b>${ucEachWord(signerName)}`));
    }

    if (subjectName) {
        $("#resultVerifyDocumentBody").append($("<p id=\"subjectName\"></p>").html(`<b>Paciente: </b>${subjectName}`));
    }

    
    $("#panelResult").addClass("valid");

    if (Array.isArray(certificates) && certificates.length > 0) {
        let printableCerts = "";
        
        let spaces = "";

        certificates.forEach((crt) => {
            printableCerts += `<li class=\"list-group-item list-group-item-info\">${spaces}<i class=\"fas fa-caret-right\"></i>&nbsp;&nbsp;${crt}</li>`;
            spaces += "&nbsp;&nbsp;&nbsp;&nbsp;";
        });

        $("#resultVerifyDocumentBody").append("<div class=\"mt-8-n\">" +
                                                    "<button id=\"btnShowCertificates\" type=\"button\" class=\"btn buttonSmall buttonLineGray dropdown-toggle\" data-toggle=\"collapse\" data-target=\"#collapseCertificates\" aria-expanded=\"false\" aria-controls=\"collapseCertificates\">" +
                                                        "<i class=\"fas fa-certificate\"></i> " +
                                                        "Certificados" +
                                                    "</button>" +
                                                    "<div class=\"collapseOnly collapse\" id=\"collapseCertificates\">" +
                                                        "<div class=\"card card-body\">" +
                                                                "<div id=\"titleCertificatesPrintable\" style=\"display: none;\"><i class=\"fas fa-certificate noPrintable\"></i> Certificados:</div>" +
                                                                "<ul id=\"certificatesList\" class=\"list-group\">" +
                                                                    printableCerts +
                                                                "</ul>" +
                                                        "</div>" +
                                                    "</div>" +
                                                "</div>"); 
    }
   
    if (rawContent && (documentKind.realm === "public" || (documentKind.realm === "private" && sourceDocumentFiles.status === "FETCHED"))) {
        $("#resultVerifyDocumentBody").append("<div class=\"mt-8-n\">" +
                                            "<button id=\"btnShowRawContent\" type=\"button\" class=\"btn buttonSmall buttonLineGray dropdown-toggle\" data-toggle=\"collapse\" data-target=\"#collapseRawContent\" aria-expanded=\"false\" aria-controls=\"collapseRawContent\">" +
                                                "<i class=\"fas fa-signature\"></i> " +
                                                "Conteúdo Assinado <small>(XML)</small>" +
                                            "</button>" +
                                            "<div class=\"collapseOnly collapse\" id=\"collapseRawContent\">" +
                                                "<div class=\"card card-body\">" +
                                                        "<div id=\"titleRawContentPrintable\" style=\"display: none;\"><i class=\"fas fa-signature noPrintable\"></i>  Conteúdo Assinado (XML):</div>" +
                                                        "<ul id=\"rawContent\" class=\"list-group\">" + 
                                                            "<li id=\"rawContentData\" class=\"list-group-item list-group-item-info\"></li>" +
                                                        "</div>" +
                                                "</div>" +
                                            "</div>" +
                                        "</div>");

        let encodedStrContent = vkbeautify.xml(rawContent).replace(/[\u00A0-\u9999<>\&]/gim, (i) => {
            return '&#'+i.charCodeAt(0)+';';
        });

        let rawEncodedStrContentSplit = encodedStrContent.split(/(?:\r\n|\r|\n)/);

        let formmatedRawData = "";

        rawEncodedStrContentSplit.forEach((line) => {
            if (!line.startsWith("&#60;?xml")) {
                formmatedRawData += `<span>${line.replace(/\s/g, "&nbsp;")}</span><br/>`; 
            }
        });
        
        $("#rawContentData").append(formmatedRawData);
    }
                                            
    preparePanelRequestInfo(authenticityCode, verifyingTimeStamp);
    prepareSourceDocumentFilesView(verifierKey, sourceDocumentFiles, documentKindLabel, documentKindIcon, subjectAuthorize);

    $("#panelResult").fadeIn("fast");
    $("#panelRequestInfo").fadeIn("fast");

    hideLoader();
};

const preparePanelRequestInfo = (authenticityCode, verifyingTimeStamp) => {
    let dateString = formatDateFromTimeStamp(verifyingTimeStamp);
    $("#panelRequestInfoBody").append($("<p></p>").html(`<b>Data da verificação: </b>${dateString}`));

    if (authenticityCode) {
        $("#panelRequestInfoBody").append($("<p></p>").html(`<b>Código de autenticidade: </b>${authenticityCode}`));
    }
};

const callCheckSignatureService = (verifierKey, subjectAuthorizeParamKind, subjectAuthorizeParamValue) => {
    $("#panelResult").fadeOut(200);
    $("#panelRequestInfo").fadeOut(200);
    showLoader();
    clearResults();
    $("#verifierKey").val(verifierKey);

    try {
        if (!SERVICE_URL || !SERVICE_URL.toString().match(URI_REGEX)) {
            showErrorResult();
        } else {
            let urlQueryString = null;
            if (subjectAuthorizeParamKind && subjectAuthorizeParamValue) {
                urlQueryString = `/?subjectAuthorizeParamKind=${encodeURI(subjectAuthorizeParamKind)}&subjectAuthorizeParamValue=${encodeURI(subjectAuthorizeParamValue)}`;
            }
            $.ajax({
                "url": `${SERVICE_URL}/signature/status/${verifierKey + (urlQueryString ? urlQueryString : "")}`, 
                "type": "GET",
                "dataType": "json",
                "success": (result) => {
                    if (result.statusCode === 200) {
                        if (result.result && result.result.data) {
                            let data = result.result.data;
                            if (data.status === "VALID") {
                                showValidResult(data.documentRealm, data.verifierKey, data.kind, data.authenticityCode, data.verifyingTimeStamp, data.signingTimeStamp, data.signerName, data.subjectName, data.certificates, data.rawContent, data.sourceDocumentFiles, data.subjectAuthorize);
                            } else if (data.status === "REPLACED") {
                                showReplacementResult(data.verifierKey, data.replacedBy, data.authenticityCode, data.verifyingTimeStamp);
                            } else {
                                showInvalidResult(data.verifierKey, data.authenticityCode, data.verifyingTimeStamp);
                            }
                        } else {
                            showErrorResult();
                        }
                    } else {
                        showErrorResult();
                    }
                },
                "error": (xhr) => {
                    switch (xhr.status) {
                        case 404:
                            showNotFoundResult(verifierKey);
                            break;
                        case 500:
                        default:
                            showErrorResult();
                    }
                }
            });
        }
    } catch (e) {
        showErrorResult();
    }
};

const showLoader = () => {
    $("#status").fadeIn();
    $("#preloader").fadeIn("fast");
};

const hideLoader = () => {
    $("#status").delay(100).fadeOut();
    $("#preloader").delay(200).fadeOut("fast");
};

const browserHasPDFSupport = () => {
    const getAcrobatInfo = function() {

        const getBrowserName = function() {
          return function() {
            const userAgent = navigator ? navigator.userAgent.toLowerCase() : "other";
      
            if(userAgent.indexOf("chrome") > -1)        return "chrome";
            else if(userAgent.indexOf("safari") > -1)   return "safari";
            else if(userAgent.indexOf("msie") > -1)     return "ie";
            else if(userAgent.indexOf("firefox") > -1)  return "firefox";
            return userAgent;
          }();
        };
      
        const getActiveXObject = function(name) {
          try { return new ActiveXObject(name); } catch(e) {}
        };
      
        const getNavigatorPlugin = function(name) {
          for(let key in navigator.plugins) {
            const plugin = navigator.plugins[key];
            if(plugin.name == name) return plugin;
          }
        };
      
        const getPDFPlugin = function() {
          return function() {
            if(getBrowserName() == 'ie') {
              //
              // load the activeX control
              // AcroPDF.PDF is used by version 7 and later
              // PDF.PdfCtrl is used by version 6 and earlier
              return getActiveXObject('AcroPDF.PDF') || getActiveXObject('PDF.PdfCtrl');
            }
            else {
              return getNavigatorPlugin('Adobe Acrobat') || getNavigatorPlugin('Chrome PDF Viewer') || getNavigatorPlugin('WebKit built-in PDF');
            }
          }();
        };
      
        const isAcrobatInstalled = function() {
          return !!getPDFPlugin();
        };
      
        const getAcrobatVersion = function() {
          try {
            var plugin = getPDFPlugin();
      
            if(getBrowserName() == 'ie') {
              var versions = plugin.GetVersions().split(',');
              var latest   = versions[0].split('=');
              return parseFloat(latest[1]);
            }
      
            if(plugin.version) return parseInt(plugin.version);
            return plugin.name
            
          }
          catch(e) {
            return null;
          }
        }
      
        // The returned object
        return {
          browser:        getBrowserName(),
          acrobat:        isAcrobatInstalled() ? 'installed' : false,
          acrobatVersion: getAcrobatVersion()
        };
      };
  
    const isIos = () => {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    };

    const isMobile = navigator.userAgent.match(/(iPad)|(iPhone)|(iPod)|(android)|(webOS)/i);
   
    return !isMobile || (navigator.mimeTypes['application/pdf'] || getAcrobatInfo().acrobat !== false || isIos())
};

$(document).ready(() => {
    configViewLayout();
    attachFormVerifyDocumentValitation();

    let verifierKey = getUrlParameter("key");

    if (verifierKey && verifierKey.toString().match(VERIFIER_KEY_REGEX)) {
        $("#verifierKey").val(verifierKey);
        callCheckSignatureService(verifierKey);
    } else {
        if (verifierKey && verifierKey.toString().length > 0) {
            $("#verifierKey").addClass("error");
            $("#verifierKey").val(verifierKey);
        }
        $("#verifierKey").focus();
        renderPreLoader();
    }
});
