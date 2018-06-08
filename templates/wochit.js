module.exports = (params) => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    actions.push({id: "wochit_token", action: "rest_call", critical: true, params: {request: file => ({
                url: "https://ingest-api.wochit.com/api/v1/oauth/access_token",
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + new Buffer(params.api_id + ":" + params.api_secret).toString("base64"),
                    'x-api-key': params.api_key
                }
            })}});
    actions.push({action: "rest_call", critical: true, params: {request: file => ({
                url: "https://ingest-api.wochit.com/api/v1/assets",
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + JSON.parse(file.results['wochit_token']).token,
                    'x-api-key': params.api_key
                },
                json: {
                    "mediaProviderAssetModels": [
                        {
                            "id": file.filename,
                            "downloadUrl": "https://" + params.bucket + ".s3.amazonaws.com/" + file.filename,
                            "type": "VIDEO",
                            "title": file.filename,
                            "caption": file.filename,
                            "publicationDate": require('moment')().utc().format(),
                            "contentType": "Editorial"
                        }
                    ]
                }
            })}});
    return actions;
};